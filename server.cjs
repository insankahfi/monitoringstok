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
// ID 3 produk sudah di-hardcode di sini (Bahan Baku, Solar
// HSD, Solar Murni) — .env cukup HMAC username/secret + PORT,
// gak perlu diisi ID produk. Kalau nanti ID-nya ganti, tinggal
// edit angka di bawah, ATAU override lewat .env pakai
// MEKARI_PRODUCT_ID_BAHAN_BAKU / _SOLAR_HSD / _SOLAR_MURNI
// kalau mau tanpa ubah kode.
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
    key: 'solar_murni',
    label: 'Solar Murni',
    id: process.env.MEKARI_PRODUCT_ID_SOLAR_MURNI || '105035777'
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
  console.warn(
    '[WARNING] Belum semua product ID kategori terisi. ' +
    'Set MEKARI_PRODUCT_ID_BAHAN_BAKU dan/atau MEKARI_PRODUCT_ID_SOLAR_MURNI di .env, ' +
    'lalu RESTART server. Cek juga GET /api/debug-categories.'
  );
}


// ============================================================
// MOVEMENT / TRANSACTION ENDPOINT (JURNAL)
//
// PENTING: path di bawah ini masih PLACEHOLDER — belum
// diverifikasi ke dokumentasi Mekari Jurnal SCM API yang asli.
// Ganti MEKARI_MOVEMENT_PATH di .env begitu path resminya
// diketahui (biasanya sejenis "stock movement" / "stock card"
// / "inventory transaction" di modul SCM Jurnal).
// ============================================================

const MEKARI_MOVEMENT_PATH =
  process.env.MEKARI_MOVEMENT_PATH ||
  '/public/jurnal/scm/public/lo/v1/products/get_product_stock_movement';


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
          timeout: 15000
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
