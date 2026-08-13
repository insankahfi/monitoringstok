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
      .createHmac('sha256', HMAC_SECRET)
      .update(stringToSign, 'utf8')
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
// MEKARI GET
// ============================================================

async function mekariGet(apiPath, params = {}) {

  const url =
    `${MEKARI_BASE_URL}${apiPath}`;

  const search =
    new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      search.append(key, String(value));
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
      err.response?.data || err.message
    );

    return {
      ok: false,
      status:
        err.response?.status || 500,
      error:
        err.response?.data ||
        err.message
    };
  }
}


// ============================================================
// EXTRACT ARRAY
// ============================================================

function extractArray(raw) {

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw;
  }

  if (Array.isArray(raw.data)) {
    return raw.data;
  }

  if (
    raw.data &&
    Array.isArray(raw.data.data)
  ) {
    return raw.data.data;
  }

  if (Array.isArray(raw.results)) {
    return raw.results;
  }

  if (Array.isArray(raw.records)) {
    return raw.records;
  }

  if (Array.isArray(raw.items)) {
    return raw.items;
  }

  if (Array.isArray(raw.result)) {
    return raw.result;
  }

  // beberapa API membungkus seperti:
  // { data: { warehouses: [...] } }

  if (
    raw.data &&
    Array.isArray(raw.data.warehouses)
  ) {
    return raw.data.warehouses;
  }

  if (
    Array.isArray(raw.warehouses)
  ) {
    return raw.warehouses;
  }

  return [];
}


// ============================================================
// NUMBER
// ============================================================

function numberOrNull(value) {

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// PRODUCT DETAIL
// ============================================================
//
// GET /api/product/:id
//
// DATA STOCK TANK DIAMBIL DARI:
// get_product_quantity_per_warehouse
//
// PRODUCT TOTAL TIDAK PERNAH DIPAKSA KE FST-01.
// ============================================================

app.get(
  '/api/product/:id',
  async (req, res) => {

    const productId =
      String(req.params.id || '').trim();

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


    // ==========================================================
    // 1. PRODUCT QUANTITY PER WAREHOUSE
    // ==========================================================

    const qtyResult =
      await mekariGet(
        '/public/jurnal/scm/public/lo/v1/products/get_product_quantity_per_warehouse',
        {
          ids: productId
        }
      );


    if (!qtyResult.ok) {

      return res
        .status(qtyResult.status)
        .json({
          success: false,
          error:
            qtyResult.error?.message ||
            `Mekari error ${qtyResult.status}`,
          detail:
            qtyResult.error
        });
    }


    // ==========================================================
    // 2. MINIFIED PRODUCT
    // ==========================================================

    const minifiedResult =
      await mekariGet(
        '/public/jurnal/scm/public/lo/v1/products/minified',
        {
          ids: productId
        }
      );


    // ==========================================================
    // LOG RAW RESPONSE
    // ==========================================================

    console.log(
      '[RAW QTY PER WAREHOUSE]',
      JSON.stringify(
        qtyResult.data,
        null,
        2
      ).slice(0, 10000)
    );

    console.log(
      '[RAW MINIFIED]',
      JSON.stringify(
        minifiedResult.data,
        null,
        2
      ).slice(0, 5000)
    );


    // ==========================================================
    // 3. PARSE QTY
    // ==========================================================

    const rawItems =
      extractArray(
        qtyResult.data
      );


    console.log(
      '[PARSED QTY ITEMS]',
      rawItems.length
    );


    // ==========================================================
    // 4. MAP WAREHOUSE
    // ==========================================================

    const warehouses = [];


    for (const item of rawItems) {

      const productIdFromRow =
        item.product_id ??
        item.product?.id ??
        null;


      /*
       * Kalau response menyediakan product_id,
       * filter hanya product yang kita minta.
       */
      if (
        productIdFromRow !== null &&
        String(productIdFromRow) !== String(productId)
      ) {
        continue;
      }


      const warehouseId =
        item.warehouse_id ??
        item.storage_id ??
        item.warehouse?.id ??
        item.storage?.id ??
        null;


      const warehouseName =
        item.warehouse_code ??
        item.storage_code ??
        item.warehouse_name ??
        item.storage_name ??
        item.warehouse?.code ??
        item.warehouse?.name ??
        item.storage?.code ??
        item.storage?.name ??
        null;


      const quantity =
        numberOrNull(
          item.quantity ??
          item.qty ??
          item.stock_quantity ??
          item.quantity_on_hand ??
          item.stock_on_hand
        );


      const quantityAvailable =
        numberOrNull(
          item.quantity_available ??
          item.available_quantity ??
          item.available_qty
        );


      /*
       * Kalau row sama sekali tidak punya warehouse,
       * JANGAN dimasukkan sebagai tank.
       */
      if (
        warehouseId === null &&
        warehouseName === null
      ) {
        console.warn(
          '[SKIP] Row tanpa warehouse:',
          JSON.stringify(item)
        );

        continue;
      }


      warehouses.push({

        id:
          warehouseId,

        name:
          warehouseName ||
          `Warehouse ${warehouseId}`,

        quantity:
          quantity ?? 0,

        quantity_available:
          quantityAvailable ??
          quantity ??
          0,

        raw:
          item

      });

    }


    // ==========================================================
    // 5. PRODUCT INFO
    // ==========================================================

    let productInfo = {};


    if (minifiedResult.ok) {

      const minified =
        extractArray(
          minifiedResult.data
        );


      productInfo =
        minified.find(
          (item) => {

            const id =
              item.id ??
              item.product_id;

            return (
              id !== undefined &&
              String(id) === String(productId)
            );

          }
        ) || {};

    }


    // ==========================================================
    // 6. TOTAL
    //
    // Total hanya dihitung dari warehouse yang benar-benar
    // berhasil dibaca.
    // ==========================================================

    let totalQuantity = null;
    let totalAvailable = null;


    if (warehouses.length > 0) {

      totalQuantity =
        warehouses.reduce(
          (sum, item) =>
            sum +
            (Number(item.quantity) || 0),
          0
        );


      totalAvailable =
        warehouses.reduce(
          (sum, item) =>
            sum +
            (
              Number(
                item.quantity_available
              ) || 0
            ),
          0
        );

    }


    // ==========================================================
    // 7. RESPONSE
    // ==========================================================

    const data = {

      id:
        productId,

      name:
        productInfo.name ??
        productInfo.product_name ??
        'Solar HSD',

      sku:
        productInfo.sku ??
        productInfo.code ??
        productInfo.product_code ??
        '-',

      unit:
        productInfo.unit ??
        productInfo.uom ??
        productInfo.unit_name ??
        'Liter',

      quantity:
        totalQuantity,

      quantity_available:
        totalAvailable,

      warehouses

    };


    return res.json({
      success: true,
      data
    });

  }
);


// ============================================================
// DEBUG STOCK
// ============================================================
//
// Buka:
//
// /api/debug-stock/48285791
//
// Ini buat kita lihat RAW + parsed response.
// ============================================================

app.get(
  '/api/debug-stock/:id',
  async (req, res) => {

    const productId =
      String(req.params.id || '').trim();

    if (!productId) {

      return res
        .status(400)
        .json({
          success: false,
          error: 'Product ID kosong.'
        });
    }


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

      raw:
        result.data,

      parsed:
        extractArray(
          result.data
        )

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

    const url =
      'https://my.jurnal.id/api/v1/sales_invoices';

    const fullUrl =
      `${url}?page=1&per_page=1`;

    const headers =
      createHmacHeader(
        'GET',
        fullUrl
      );


    console.log(
      '[SANITY]',
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


      return res.json({

        success: true,

        message:
          'HMAC bekerja.',

        status:
          response.status,

        data:
          response.data

      });

    } catch (err) {

      return res
        .status(
          err.response?.status || 500
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
// ERROR HANDLER
// ============================================================

app.use(
  (err, req, res, next) => {

    console.error(
      '[SERVER ERROR]',
      err
    );

    if (res.headersSent) {
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
      ` PORT : ${PORT}`
    );

    console.log(
      ` MEKARI : ${MEKARI_BASE_URL}`
    );

    console.log(
      '=========================================='
    );

  }
);