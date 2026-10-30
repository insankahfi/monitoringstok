'use strict';

require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const { URL } = require('url');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// ============================================================
// PATCH SALES ATL
// Letakkan sesudah express.static, sebelum const PORT.
// Memakai fungsi mekariGet yang sudah ada pada server ini.
// ============================================================

console.log('[ATL SALES PATCH V2] Aktif');
console.log('[SERVER FILE]', __filename);

// Penanda untuk memastikan file server yang benar sudah berjalan.
app.get('/api/sales-check', (req, res) => {
  res.json({
    success: true,
    version: 'ATL-SALES-V2',
    endpoint: '/public/jurnal/api/v1/sales_invoices'
  });
});

// Hentikan pemanggilan stock movement placeholder.
// Ini hanya memengaruhi log movement, bukan data stok tangki.
app.get('/api/movements', (req, res, next) => {
  const configuredPath =
    String(process.env.MEKARI_MOVEMENT_PATH || '').trim();

  if (
    configuredPath &&
    !configuredPath.includes('get_product_stock_movement')
  ) {
    return next();
  }

  return res.status(501).json({
    success: false,
    error:
      'Log bahan belum terhubung: endpoint movement belum valid. ' +
      'Sales ATL-Pro / ATL-Diesel dimuat terpisah.'
  });
});

app.get('/api/log-keluar', async (req, res) => {
  const salesPath = '/public/jurnal/api/v1/sales_invoices';

  const page = Number(req.query.page ?? 1);
  const perPage = Number(req.query.limit ?? 10);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  ) {
    return res.status(400).json({
      success: false,
      error: 'page harus >= 1 dan limit harus 1–100.'
    });
  }

  if (
    !process.env.MEKARI_HMAC_USERNAME ||
    !process.env.MEKARI_HMAC_SECRET
  ) {
    return res.status(503).json({
      success: false,
      error:
        'MEKARI_HMAC_USERNAME / MEKARI_HMAC_SECRET belum terisi.'
    });
  }

  const targetProducts = [
    {
      id: String(
        process.env.MEKARI_PRODUCT_ID_ATL_PRO || '105040526'
      ),
      name: 'ATL-Pro'
    },
    {
      id: String(
        process.env.MEKARI_PRODUCT_ID_ATL_DIESEL || '105040667'
      ),
      name: 'ATL-Diesel'
    }
  ];

  function normalizeName(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[\s_-]/g, '');
  }

  function getLines(invoice) {
    if (Array.isArray(invoice.transaction_lines_attributes)) {
      return invoice.transaction_lines_attributes;
    }

    if (Array.isArray(invoice.transaction_lines)) {
      return invoice.transaction_lines;
    }

    return null;
  }

  function isExcluded(invoice) {
    const status = String(
      typeof invoice.status === 'string'
        ? invoice.status
        : invoice.status?.name || ''
    ).trim().toLowerCase();

    return Boolean(invoice.deleted_at) || [
      'draft',
      'void',
      'voided',
      'cancelled',
      'canceled',
      'deleted'
    ].includes(status);
  }

  function normalizeDate(value) {
    const text = String(value || '').trim();

    const match = text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );

    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }

    return text || null;
  }

  async function readMekari(apiPath, params = {}) {
    const result = await mekariGet(apiPath, params);

    if (!result.ok) {
      const detail =
        result.error?.message ||
        (
          typeof result.error === 'string'
            ? result.error
            : 'Permintaan ditolak oleh Mekari'
        );

      const error = new Error(
        `Mekari Sales HTTP ${result.status}: ${detail}`
      );

      error.status = result.status || 502;

      throw error;
    }

    return result.data;
  }

  try {
    console.log(
      `[ATL SALES V2] page=${page}, per_page=${perPage}`
    );

    const payload = await readMekari(salesPath, {
      page,
      per_page: perPage
    });

    const invoices =
      payload?.sales_invoices ??
      payload?.data?.sales_invoices ??
      (
        Array.isArray(payload?.data)
          ? payload.data
          : null
      );

    if (!Array.isArray(invoices)) {
      console.error(
        '[SALES RESPONSE KEYS]',
        Object.keys(payload || {})
      );

      throw new Error(
        'Format Sales List belum cocok. ' +
        'Array sales_invoices tidak ditemukan pada respons Mekari.'
      );
    }

    const rows = [];
    const seenInvoices = new Set();

    for (const summary of invoices) {
      if (!summary || typeof summary !== 'object') {
        throw new Error('Data invoice dari Mekari tidak valid.');
      }

      if (isExcluded(summary)) {
        continue;
      }

      const invoiceId = summary.id;

      if (invoiceId === undefined || invoiceId === null) {
        throw new Error('Ada invoice tanpa ID pada Sales List.');
      }

      if (seenInvoices.has(String(invoiceId))) {
        continue;
      }

      seenInvoices.add(String(invoiceId));

      let invoice = summary;
      let lines = getLines(invoice);

      // List invoice bisa hanya memuat ringkasan.
      // Ambil detail agar produk dan quantity dapat dibaca.
      if (lines === null) {
        const detailPayload = await readMekari(
          `${salesPath}/${encodeURIComponent(invoiceId)}`
        );

        const detail =
          detailPayload?.sales_invoice ??
          detailPayload?.data?.sales_invoice ??
          detailPayload?.data;

        if (
          !detail ||
          typeof detail !== 'object' ||
          Array.isArray(detail)
        ) {
          throw new Error(
            `Format detail invoice ${invoiceId} belum cocok.`
          );
        }

        invoice = {
          ...summary,
          ...detail
        };

        lines = getLines(invoice);
      }

      if (isExcluded(invoice)) {
        continue;
      }

      if (!Array.isArray(lines)) {
        throw new Error(
          `Detail produk invoice ${invoiceId} tidak ditemukan.`
        );
      }

      for (const [index, line] of lines.entries()) {
        const productId =
          line.product?.id ??
          line.product_id;

        const productName =
          line.product?.name ??
          line.product_name ??
          '';

        const target = targetProducts.find((product) => {
          // Jika ID tersedia, gunakan ID sebagai acuan utama.
          if (productId !== undefined && productId !== null) {
            return String(productId) === product.id;
          }

          return (
            normalizeName(productName) ===
            normalizeName(product.name)
          );
        });

        if (!target) {
          continue;
        }

        if (
          line.quantity === undefined ||
          line.quantity === null ||
          String(line.quantity).trim() === ''
        ) {
          throw new Error(
            `Quantity ${target.name} pada invoice ${invoiceId} kosong.`
          );
        }

        const quantity = Number(line.quantity);

        if (!Number.isFinite(quantity)) {
          throw new Error(
            `Quantity invoice ${invoiceId} tidak valid.`
          );
        }

        // Log ini mencatat produk keluar.
        // Quantity negatif/retur tidak dihitung sebagai keluar.
        if (quantity <= 0) {
          continue;
        }

        const unit =
          typeof line.unit === 'string'
            ? line.unit
            : line.unit?.name || 'Liter';

        rows.push({
          id: `${invoiceId}:${line.id ?? index}`,

          invoiceId,

          invoiceNumber:
            invoice.transaction_no ??
            invoice.transaction_number ??
            String(invoiceId),

          date: normalizeDate(
            invoice.transaction_date ??
            invoice.date
          ),

          customer:
            invoice.person?.display_name ??
            invoice.person?.name ??
            invoice.customer?.display_name ??
            invoice.customer?.name ??
            '-',

          productId: target.id,
          productName: target.name,

          quantity,
          unit,

          warehouse:
            line.warehouse?.name ??
            invoice.warehouse?.name ??
            '-',

          note:
            line.description ??
            invoice.memo ??
            ''
        });
      }
    }

    // Urutkan tanggal dalam halaman yang sedang dibaca.
    rows.sort((a, b) => {
      return String(b.date || '').localeCompare(
        String(a.date || '')
      );
    });

    const totalPagesValue =
      payload.total_pages ??
      payload.meta?.total_pages ??
      payload.pagination?.total_pages;

    const totalPages = Number(totalPagesValue);

    const hasKnownTotal =
      totalPagesValue !== undefined &&
      totalPagesValue !== null &&
      Number.isInteger(totalPages) &&
      totalPages >= 0;

    console.log(
      `[ATL SALES V2] ${invoices.length} invoice, ` +
      `${rows.length} baris produk ATL`
    );

    return res.json({
      success: true,

      data: rows,

      meta: {
        page,
        perPage,
        invoicesScanned: invoices.length,

        hasNext: hasKnownTotal
          ? page < totalPages
          : invoices.length >= perPage,

        source: 'sales_invoices'
      }
    });
  } catch (err) {
    console.error('[ATL SALES V2 ERROR]', err.message);

    return res.status(err.status || 502).json({
      success: false,
      error: err.message || 'Gagal mengambil sales invoice.'
    });
  }
});

// ================= END PATCH SALES ATL =================

const PORT = process.env.PORT || 3000;

const MEKARI_BASE_URL =
  process.env.MEKARI_BASE_URL || 'https://api.mekari.com';

const HMAC_USERNAME =
  process.env.MEKARI_HMAC_USERNAME;

const HMAC_SECRET =
  process.env.MEKARI_HMAC_SECRET;


// ============================================================
// PRODUCT CATEGORIES
//
// ID produk sudah di-hardcode di sini — .env cukup HMAC
// username/secret + PORT, gak perlu diisi ID produk. Kalau
// nanti ID-nya ganti atau nambah produk baru, tinggal
// tambah/edit entry di array bawah, ATAU override lewat .env
// pakai MEKARI_PRODUCT_ID_<KEY_UPPERCASE> kalau mau tanpa
// ubah kode.
// ============================================================

const ALL_PRODUCT_CATEGORIES = [
  {
    key: 'bahan_baku',
    label: 'Bahan Baku',
    id: process.env.MEKARI_PRODUCT_ID_BAHAN_BAKU || '104647330'
  },
  {
    key: 'solar_hsd',
    label: 'Solar HSD',
    id: process.env.MEKARI_PRODUCT_ID_SOLAR_HSD || '48285791'
  },
  {
    key: 'tirisan_produk',
    label: 'Tirisan Produk',
    id: process.env.MEKARI_PRODUCT_ID_SOLAR_MURNI || '105059390'
  },
  {
    key: 'atl_pro',
    label: 'ATL-Pro',
    id: process.env.MEKARI_PRODUCT_ID_ATL_PRO || '105040526'
  },
  {
    key: 'atl_diesel',
    label: 'ATL-Diesel',
    id: process.env.MEKARI_PRODUCT_ID_ATL_DIESEL || '105040667'
  }
];

const PRODUCT_CATEGORIES =
  ALL_PRODUCT_CATEGORIES.filter(
    (category) => category.id
  );


console.log('');
console.log('[PRODUCT CATEGORIES]');

ALL_PRODUCT_CATEGORIES.forEach(
  (category) => {

    console.log(
      ` - ${category.label} (${category.key}): ` +
      (
        category.id
          ? `AKTIF, id=${category.id}`
          : 'BELUM DIISI — set di .env, kategori ini TIDAK akan ditarik dari Mekari'
      )
    );

  }
);

console.log('');


if (
  PRODUCT_CATEGORIES.length < ALL_PRODUCT_CATEGORIES.length
) {

  const missing =
    ALL_PRODUCT_CATEGORIES
      .filter((category) => !category.id)
      .map((category) => category.label)
      .join(', ');

  console.warn(
    `[WARNING] Kategori belum diisi ID: ${missing}. ` +
    'Isi di ALL_PRODUCT_CATEGORIES (server.cjs) atau lewat .env, ' +
    'lalu RESTART server. Cek juga GET /api/debug-categories.'
  );
}


// ============================================================
// Optional movement endpoint: never call an unverified placeholder.
const MEKARI_MOVEMENT_PATH = process.env.MEKARI_MOVEMENT_PATH || '';
const MEKARI_SALES_PATH = process.env.MEKARI_SALES_PATH ||
  '/public/jurnal/api/v1/sales_invoices';

// ============================================================
// CHECK ENV
// ============================================================

if (!HMAC_USERNAME || !HMAC_SECRET) {
  console.error(
    '[ERROR] MEKARI_HMAC_USERNAME / MEKARI_HMAC_SECRET belum ada.'
  );
}


// ============================================================
// HMAC
// ============================================================

function createHmacHeader(method, fullUrl) {

  const urlObj = new URL(fullUrl);

  const requestLine =
    `${method.toUpperCase()} ` +
    `${urlObj.pathname}${urlObj.search} ` +
    `HTTP/1.1`;

  const dateHeader =
    new Date().toUTCString();

  const stringToSign =
    `date: ${dateHeader}\n${requestLine}`;

  const signature =
    crypto
      .createHmac(
        'sha256',
        HMAC_SECRET || ''
      )
      .update(
        stringToSign,
        'utf8'
      )
      .digest('base64');

  const authorization =
    `hmac username="${HMAC_USERNAME}", ` +
    `algorithm="hmac-sha256", ` +
    `headers="date request-line", ` +
    `signature="${signature}"`;

  return {
    Authorization: authorization,
    Date: dateHeader,
    Accept: 'application/json'
  };
}


// ============================================================
// GET MEKARI
// ============================================================

async function mekariGet(
  apiPath,
  params = {}
) {

  const url =
    `${MEKARI_BASE_URL}${apiPath}`;

  const search =
    new URLSearchParams();

  for (
    const [key, value]
    of Object.entries(params)
  ) {

    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {

      search.append(
        key,
        String(value)
      );

    }

  }

  const query =
    search.toString();

  const fullUrl =
    query
      ? `${url}?${query}`
      : url;

  const headers =
    createHmacHeader(
      'GET',
      fullUrl
    );

  console.log('');
  console.log('==========================================');
  console.log('[MEKARI GET]');
  console.log(fullUrl);
  console.log('==========================================');

  try {

    const response =
      await axios.get(
        fullUrl,
        {
          headers,
          timeout: 30000
        }
      );

    console.log(
      '[MEKARI STATUS]',
      response.status
    );

    return {
      ok: true,
      data: response.data
    };

  } catch (err) {

    console.error(
      '[MEKARI ERROR]',
      err.response?.status,
      err.response?.data ||
      err.message
    );

    return {
      ok: false,
      status:
        err.response?.status ||
        500,
      error:
        err.response?.data ||
        {
          message: err.message
        }
    };

  }

}


// ============================================================
// PRODUCT STOCK
//
// Endpoint asli yang sudah terbukti mengembalikan:
//
// data[0]
//   id
//   name
//   code
//   unit
//   warehouse_inventory[]
//   quantity
// ============================================================

function mapMekariProductToData(
  product,
  fallbackId
) {

  const inventory =
    Array.isArray(
      product.warehouse_inventory
    )
      ? product.warehouse_inventory
      : [];


  const warehouses =
    inventory.map(
      (warehouse) => {

        const quantity =
          Number(
            warehouse?.quantity
          ) || 0;


        return {

          id:
            warehouse?.id ??
            null,

          name:
            warehouse?.name ??
            warehouse?.code ??
            'Warehouse',

          code:
            warehouse?.code ??
            '',

          quantity,

          quantity_available:
            quantity

        };

      }
    );


  return {

    id:
      product.id ??
      fallbackId,

    name:
      product.name ??
      'Produk',

    sku:
      product.code ??
      '-',

    unit:
      product.unit ??
      'Liter',

    // Total seluruh warehouse.
    // BUKAN stok satu tank saja.
    quantity:
      Number(
        product.quantity
      ) || 0,

    quantity_available:
      Number(
        product.quantity
      ) || 0,

    warehouses

  };

}


app.get(
  '/api/product/:id',
  async (req, res) => {

    const productId =
      String(
        req.params.id || ''
      ).trim();


    if (!productId) {

      return res
        .status(400)
        .json({
          success: false,
          error: 'Product ID kosong.'
        });

    }


    console.log(
      `[API] Product ${productId}`
    );


    const result =
      await mekariGet(
        '/public/jurnal/scm/public/lo/v1/products/get_product_quantity_per_warehouse',
        {
          ids: productId
        }
      );


    if (!result.ok) {

      return res
        .status(result.status)
        .json({
          success: false,
          error:
            result.error?.message ||
            `Mekari error ${result.status}`,
          detail:
            result.error
        });

    }


    const product =
      Array.isArray(
        result.data?.data
      )
        ? result.data.data.find(
            (item) =>
              String(item?.id) ===
              String(productId)
          ) || result.data.data[0]
        : null;


    if (!product) {

      return res
        .status(404)
        .json({
          success: false,
          error:
            'Product tidak ditemukan di Mekari.'
        });

    }


    return res.json({
      success: true,
      data:
        mapMekariProductToData(
          product,
          productId
        )
    });

  }
);


// ============================================================
// MULTI-CATEGORY STOCK
//
// Menarik semua kategori produk (Bahan Baku, Solar HSD,
// Solar Murni) sekaligus dalam satu request ke Mekari, lalu
// mengembalikan data per kategori supaya setiap tangki di
// frontend menampilkan isi asli warehouse-nya, bukan cuma
// satu produk yang di-hardcode.
// ============================================================

app.get(
  '/api/stock',
  async (req, res) => {

    if (!PRODUCT_CATEGORIES.length) {

      return res
        .status(500)
        .json({
          success: false,
          error:
            'Belum ada product ID kategori yang dikonfigurasi di .env.'
        });

    }


    const ids =
      PRODUCT_CATEGORIES
        .map((category) => category.id)
        .join(',');


    const result =
      await mekariGet(
        '/public/jurnal/scm/public/lo/v1/products/get_product_quantity_per_warehouse',
        {
          ids
        }
      );


    if (!result.ok) {

      return res
        .status(result.status)
        .json({
          success: false,
          error:
            result.error?.message ||
            `Mekari error ${result.status}`,
          detail:
            result.error
        });

    }


    const list =
      Array.isArray(
        result.data?.data
      )
        ? result.data.data
        : [];


    const categories =
      PRODUCT_CATEGORIES.map(
        (category) => {

          const product =
            list.find(
              (item) =>
                String(item?.id) ===
                String(category.id)
            );


          if (!product) {

            return {

              key:
                category.key,

              label:
                category.label,

              productId:
                category.id,

              found:
                false,

              name:
                category.label,

              sku:
                '-',

              unit:
                'Liter',

              warehouses:
                []

            };

          }


          const data =
            mapMekariProductToData(
              product,
              category.id
            );


          return {

            key:
              category.key,

            label:
              category.label,

            productId:
              data.id,

            found:
              true,

            name:
              data.name,

            sku:
              data.sku,

            unit:
              data.unit,

            warehouses:
              data.warehouses

          };

        }
      );


    const unconfigured =
      ALL_PRODUCT_CATEGORIES
        .filter((category) => !category.id)
        .map((category) => category.label);


    return res.json({
      success: true,
      data: {
        categories
      },
      unconfigured
    });

  }
);


// ============================================================
// MOVEMENTS / TRANSACTION LIST (LOG BAHAN & LOG PRODUK)
//
// PENTING: path & bentuk response Mekari untuk stock
// movement/transaction list BELUM diverifikasi (lihat
// MEKARI_MOVEMENT_PATH di atas). Sesuaikan parsing di bawah
// begitu response asli dari Jurnal diketahui.
// ============================================================

app.get(
  '/api/movements',
  async (req, res) => {

    if (!MEKARI_MOVEMENT_PATH) {
      return res.status(501).json({ success: false,
        error: 'Log bahan belum dikonfigurasi. Sales produk keluar tersedia terpisah.' });
    }

    const category =
      String(
        req.query.category || 'product'
      ).trim();

    const limit =
      Number(req.query.limit) || 20;


    const ids =
      category === 'raw'
        ? (
            PRODUCT_CATEGORIES.find(
              (c) => c.key === 'bahan_baku'
            )?.id || ''
          )
        : PRODUCT_CATEGORIES
            .filter(
              (c) => c.key !== 'bahan_baku'
            )
            .map((c) => c.id)
            .join(',');


    if (!ids) {

      return res
        .status(200)
        .json({
          success: true,
          data: []
        });

    }


    const result =
      await mekariGet(
        MEKARI_MOVEMENT_PATH,
        {
          ids,
          per_page: limit
        }
      );


    if (!result.ok) {

      return res
        .status(result.status)
        .json({
          success: false,
          error:
            result.error?.message ||
            `Mekari error ${result.status}. ` +
            'Cek MEKARI_MOVEMENT_PATH di .env — endpoint ini masih placeholder.',
          detail:
            result.error
        });

    }


    const rows =
      Array.isArray(
        result.data?.data
      )
        ? result.data.data
        : [];


    const movements =
      rows
        .slice(0, limit)
        .map(
          (row) => ({

            date:
              row.date ??
              row.transaction_date ??
              row.created_at ??
              null,

            type:
              row.type ??
              row.transaction_type ??
              row.movement_type ??
              '-',

            productName:
              row.product_name ??
              row.product?.name ??
              '-',

            warehouse:
              row.warehouse_name ??
              row.warehouse?.name ??
              row.warehouse_code ??
              '-',

            quantity:
              Number(
                row.quantity ??
                row.qty ??
                0
              ) || 0,

            unit:
              row.unit ??
              'Liter',

            note:
              row.description ??
              row.note ??
              row.reference_number ??
              ''

          })
        );


    return res.json({
      success: true,
      data: movements
    });

  }
);


// ============================================================
// SALES LIST: one upstream page, all matching lines (never truncate an invoice).
function salesLines(invoice) {
  return invoice.transaction_lines_attributes ?? invoice.transaction_lines;
}
function salesDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || ''));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value || null;
}
function excludedInvoice(invoice) {
  const status = typeof invoice.status === 'string' ? invoice.status.toLowerCase() : '';
  return invoice.deleted_at || ['draft', 'void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(status);
}
function mapSales(invoice) {
  if (excludedInvoice(invoice)) return [];
  const lines = salesLines(invoice);
  if (!Array.isArray(lines)) throw new Error('Detail invoice tidak memiliki transaction_lines_attributes/transaction_lines.');
  return lines.flatMap((line, index) => {
    const id = line.product?.id ?? line.product_id;
    const name = String(line.product?.name ?? line.product_name ?? '').trim();
    const category = PRODUCT_CATEGORIES.find(c =>
      ['atl_pro', 'atl_diesel'].includes(c.key) &&
      (id != null ? String(id) === String(c.id) :
        name.toUpperCase().replace(/[ _-]/g, '') === c.label.toUpperCase().replace(/[ _-]/g, '')));
    if (!category) return [];
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity)) throw new Error('Quantity invoice tidak valid.');
    if (quantity <= 0) return []; // returns are not outgoing sales
    return [{ id: `${invoice.id}:${line.id ?? index}`, invoiceId: invoice.id,
      date: salesDate(invoice.transaction_date ?? invoice.date),
      invoiceNumber: invoice.transaction_no ?? invoice.transaction_number ?? String(invoice.id),
      customer: invoice.person?.display_name ?? invoice.customer?.display_name ?? invoice.customer?.name ?? '-',
      productName: category.label, productId: category.id, quantity,
      unit: typeof line.unit === 'string' ? line.unit : line.unit?.name || 'Liter',
      warehouse: line.warehouse?.name ?? invoice.warehouse?.name ?? '-',
      note: line.description ?? invoice.memo ?? '' }];
  });
}
async function getSales(apiPath, params) {
  const result = await mekariGet(apiPath, params);
  if (!result.ok) {
    const error = new Error(`Mekari Sales (${result.status}): ${result.error?.message || 'Permintaan gagal'}. Periksa akses Sales Invoice dan MEKARI_SALES_PATH.`);
    error.status = result.status;
    throw error;
  }
  return result.data;
}
app.get('/api/log-keluar', async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const perPage = Number(req.query.limit ?? 30);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    return res.status(400).json({ success: false, error: 'page harus >= 1 dan limit 1–100 (bilangan bulat).' });
  }
  if (!HMAC_USERNAME || !HMAC_SECRET) {
    return res.status(503).json({ success: false, error: 'Isi MEKARI_HMAC_USERNAME dan MEKARI_HMAC_SECRET di .env.' });
  }
  try {
    const payload = await getSales(MEKARI_SALES_PATH, { page, per_page: perPage });
    const invoices = payload.sales_invoices ?? payload.data?.sales_invoices ?? payload.data;
    if (!Array.isArray(invoices)) throw new Error('Format Sales List tidak dikenali; dibutuhkan array sales_invoices.');
    const rows = [];
    const seen = new Set();
    for (let invoice of invoices) {
      if (excludedInvoice(invoice)) continue;
      if (invoice.id == null) throw new Error('Invoice tidak memiliki ID.');
      if (seen.has(String(invoice.id))) continue;
      seen.add(String(invoice.id));
      if (!Array.isArray(salesLines(invoice))) {
        const detail = await getSales(`${MEKARI_SALES_PATH.replace(/\/$/, '')}/${encodeURIComponent(invoice.id)}`);
        const record = detail.sales_invoice ?? detail.data?.sales_invoice ?? detail.data;
        if (!record || Array.isArray(record)) throw new Error('Format detail Sales Invoice tidak dikenali.');
        invoice = { ...invoice, ...record };
      }
      rows.push(...mapSales(invoice));
    }
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const totalPages = Number(payload.total_pages ?? payload.meta?.total_pages);
    res.json({ success: true, data: rows, meta: { page, perPage,
      invoicesScanned: invoices.length,
      hasNext: Number.isFinite(totalPages) ? page < totalPages : invoices.length >= perPage,
      source: 'sales_invoices',
      note: 'Berdasarkan faktur penjualan, bukan konfirmasi pengiriman fisik. Urutan halaman mengikuti Mekari.' } });
  } catch (error) {
    res.status(error.status || 502).json({ success: false, error: error.message });
  }
});

// ============================================================
// DEBUG: CEK KATEGORI PRODUK AKTIF
//
// Buka langsung di browser: /api/debug-categories
// Buat mastiin .env kebaca bener & server sudah restart
// setelah ID Bahan Baku / Solar Murni diisi.
// ============================================================

app.get(
  '/api/debug-categories',
  (req, res) => {

    res.json({

      success: true,

      categories:
        ALL_PRODUCT_CATEGORIES.map(
          (category) => ({

            key:
              category.key,

            label:
              category.label,

            configured:
              Boolean(category.id),

            id:
              category.id || null

          })
        ),

      note:
        'Kalau "configured" ada yang false, isi ID-nya di .env lalu RESTART server (bukan cuma save file).'

    });

  }
);


// ============================================================
// DEBUG RAW STOCK
// ============================================================

app.get(
  '/api/debug-stock/:id',
  async (req, res) => {

    const productId =
      String(
        req.params.id || ''
      ).trim();


    const result =
      await mekariGet(
        '/public/jurnal/scm/public/lo/v1/products/get_product_quantity_per_warehouse',
        {
          ids: productId
        }
      );


    if (!result.ok) {

      return res
        .status(result.status)
        .json({
          success: false,
          error: result.error
        });

    }


    res.json({
      success: true,
      productId,
      raw: result.data
    });

  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  '/api/health',
  (req, res) => {

    res.json({

      success: true,

      server:
        'ATL Energy',

      mekari:
        MEKARI_BASE_URL,

      hmacConfigured:
        Boolean(
          HMAC_USERNAME &&
          HMAC_SECRET
        ),

      time:
        new Date().toISOString()

    });

  }
);


// ============================================================
// HMAC SANITY CHECK
// ============================================================

app.get(
  '/api/test-hmac-sanity',
  async (req, res) => {

    const fullUrl =
      'https://my.jurnal.id/api/v1/sales_invoices?page=1&per_page=1';


    const headers =
      createHmacHeader(
        'GET',
        fullUrl
      );


    try {

      const response =
        await axios.get(
          fullUrl,
          {
            headers,
            timeout: 15000
          }
        );


      res.json({

        success: true,

        status:
          response.status,

        message:
          'HMAC bekerja.'

      });

    } catch (err) {

      res
        .status(
          err.response?.status ||
          500
        )
        .json({

          success: false,

          error:
            err.response?.data ||
            err.message

        });

    }

  }
);


// ============================================================
// STOCK ADJUSTMENT
// ============================================================

app.post(
  '/api/stock-adjust',
  (req, res) => {

    res
      .status(501)
      .json({

        success: false,

        error:
          'Stock adjustment belum diaktifkan.'

      });

  }
);


// ============================================================
// API 404
// ============================================================

app.use(
  '/api',
  (req, res) => {

    console.warn(
      `[API 404] ${req.method} ${req.originalUrl}`
    );

    res
      .status(404)
      .json({

        success: false,

        error:
          'Endpoint API tidak ditemukan.'

      });

  }
);


// ============================================================
// GLOBAL ERROR
// ============================================================

app.use(
  (err, req, res, next) => {

    console.error(
      '[SERVER ERROR]',
      err
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res
      .status(500)
      .json({

        success: false,

        error:
          'Terjadi kesalahan pada server.'

      });

  }
);


// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {

    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      ' ATL ENERGY STOCK MONITORING'
    );

    console.log(
      ` PORT   : ${PORT}`
    );

    console.log(
      ` MEKARI : ${MEKARI_BASE_URL}`
    );

    console.log(
      '=========================================='
    );

  }
);
