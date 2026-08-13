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


    console.log(
      '[RAW STOCK RESPONSE]',
      JSON.stringify(
        result.data,
        null,
        2
      ).slice(0, 15000)
    );


    // ==========================================================
    // AMBIL PRODUCT DARI data[0]
    // ==========================================================

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


    // ==========================================================
    // AMBIL WAREHOUSE INVENTORY
    // ==========================================================

    const inventory =
      Array.isArray(
        product.warehouse_inventory
      )
        ? product.warehouse_inventory
        : [];


    // ==========================================================
    // MAP WAREHOUSE
    // ==========================================================

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


    // ==========================================================
    // DATA KE FRONTEND
    // ==========================================================

    const data = {

      id:
        product.id ??
        productId,

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
      // BUKAN stok FST-01.
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


    console.log(
      '[WAREHOUSE MAPPING]'
    );

    warehouses.forEach(
      (warehouse) => {

        console.log(
          `${warehouse.code || warehouse.name}: ${warehouse.quantity}`
        );

      }
    );


    return res.json({
      success: true,
      data
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