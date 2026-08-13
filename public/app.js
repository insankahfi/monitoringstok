(function () {
  'use strict';

  const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const TEST_PRODUCT_ID = '48285791';

  // ============================================================
  // MASTER TANK
  // ============================================================

  const RAW_TANKS = [
    'ST-01',
    'ST-02',
    'ST-03',
    'ST-04',
    'ST-05'
  ];

  const PRODUCT_TANKS = [
    'FST-01',
    'FST-02',
    'TK-01',
    'TK-02',
    'TK-03',
    'TK-04',
    'WT-01',
    'WT-02',
    'WT-03',
    'WT-04'
  ];

  // ============================================================
  // ELEMENT
  // ============================================================

  const el = {

    rawGrid:
      document.getElementById(
        'rawMaterialsGrid'
      ),

    productGrid:
      document.getElementById(
        'productsGrid'
      ),

    lastUpdate:
      document.getElementById(
        'lastUpdate'
      ),

    refreshBtn:
      document.getElementById(
        'refreshBtn'
      ),

    loadingBar:
      document.getElementById(
        'loadingBar'
      ),

    globalError:
      document.getElementById(
        'globalError'
      ),

    modal:
      document.getElementById(
        'detailModal'
      ),

    modalTitle:
      document.getElementById(
        'modalTitle'
      ),

    modalBody:
      document.getElementById(
        'modalBody'
      ),

    modalClose:
      document.getElementById(
        'modalClose'
      ),

    opnameForm:
      document.getElementById(
        'opnameForm'
      ),

    opnameQtySistem:
      document.getElementById(
        'opnameQtySistem'
      ),

    opnameQtyFisik:
      document.getElementById(
        'opnameQtyFisik'
      ),

    opnameSelisih:
      document.getElementById(
        'opnameSelisih'
      ),

    opnameNote:
      document.getElementById(
        'opnameNote'
      ),

    opnameMessage:
      document.getElementById(
        'opnameMessage'
      ),

    confirmModal:
      document.getElementById(
        'confirmModal'
      ),

    confirmCancel:
      document.getElementById(
        'confirmCancel'
      )

  };


  let isFetching = false;

  let currentProduct = null;


  // ============================================================
  // LOAD DASHBOARD
  // ============================================================

  async function loadDashboard() {

    if (isFetching) {
      return;
    }

    isFetching = true;

    setLoading(true);

    hideGlobalError();


    // Master tank selalu ada.
    renderRawMaterials();

    renderProductMaster();


    try {

      const product =
        await fetchProduct(
          TEST_PRODUCT_ID
        );


      renderProduct(
        product
      );


      updateLastUpdate();


    } catch (err) {

      console.error(
        '[Dashboard]',
        err
      );


      // Jangan hilangkan kartu.
      renderRawMaterials();

      renderProductMaster();


      showGlobalError(
        err.message ||
        'Gagal mengambil data dari Mekari Jurnal.'
      );


    } finally {

      isFetching = false;

      setLoading(false);

    }

  }


  // ============================================================
  // FETCH PRODUCT
  // ============================================================

  async function fetchProduct(
    productId
  ) {

    const res =
      await fetch(
        `/api/product/${encodeURIComponent(productId)}`
      );


    let body;


    try {

      body =
        await res.json();

    } catch (err) {

      throw new Error(
        'Response server bukan JSON yang valid.'
      );

    }


    if (!res.ok) {

      throw new Error(
        body.error ||
        'Gagal mengambil data product.'
      );

    }


    if (!body.success) {

      throw new Error(
        body.error ||
        'Mekari tidak mengembalikan data product.'
      );

    }


    return normalizeProduct(
      body.data
    );

  }


  // ============================================================
  // NORMALIZE
  // ============================================================

  function normalizeProduct(
    raw
  ) {

    const product =
      raw?.data ||
      raw ||
      {};


    return {

      id:
        product.id ??
        product.product_id ??
        TEST_PRODUCT_ID,

      name:
        product.name ??
        product.product_name ??
        'Solar HSD',

      sku:
        product.sku ??
        product.code ??
        product.product_code ??
        '-',

      quantity:
        toNumber(
          product.quantity
        ) ?? 0,

      quantityAvailable:
        toNumber(
          product.quantity_available
        ) ??
        toNumber(
          product.quantity
        ) ??
        0,

      unit:
        product.unit ??
        product.uom ??
        product.unit_name ??
        'Liter',

      warehouses:
        Array.isArray(
          product.warehouses
        )
          ? product.warehouses
          : [],

      raw:
        product

    };

  }


  // ============================================================
  // BAHAN BAKU
  // ============================================================

  function renderRawMaterials() {

    el.rawGrid.innerHTML =
      '';


    RAW_TANKS.forEach(
      (tank) => {

        el.rawGrid.appendChild(
          buildCard({

            type:
              'raw',

            label:
              tank,

            code:
              tank,

            name:
              'Bahan Baku',

            qty:
              0,

            availableQty:
              0,

            unit:
              'Liter',

            status:
              'grey'

          })
        );

      }
    );

  }


  // ============================================================
  // PRODUCT MASTER
  // ============================================================

  function renderProductMaster() {

    el.productGrid.innerHTML =
      '';


    PRODUCT_TANKS.forEach(
      (tank) => {

        el.productGrid.appendChild(
          buildCard({

            type:
              'product',

            label:
              tank,

            code:
              tank,

            name:
              'Produk',

            qty:
              0,

            availableQty:
              0,

            unit:
              'Liter',

            status:
              'grey',

            warehouseId:
              null

          })
        );

      }
    );

  }


  // ============================================================
  // RENDER PRODUCT
  //
  // INI INTI FIX:
  //
  // 17.000 TOTAL tidak pernah dimasukkan ke FST-01.
  //
  // Yang dipakai hanya:
  //
  // product.warehouses[]
  //
  // ============================================================

  function renderProduct(
    product
  ) {

    const map =
      {};


    // ----------------------------------------------------------
    // Buat semua master dengan 0
    // ----------------------------------------------------------

    PRODUCT_TANKS.forEach(
      (tank) => {

        map[
          normalizeKey(tank)
        ] = {

          type:
            'product',

          label:
            tank,

          code:
            tank,

          name:
            product.name ||
            'Produk',

          qty:
            0,

          availableQty:
            0,

          unit:
            product.unit ||
            'Liter',

          productId:
            product.id,

          sku:
            product.sku,

          warehouseId:
            null,

          status:
            'grey'

        };

      }
    );


    // ----------------------------------------------------------
    // Isi dari warehouse_inventory
    // ----------------------------------------------------------

    product.warehouses.forEach(
      (warehouse) => {

        const code =
          normalizeWarehouseCode(
            warehouse.code ||
            warehouse.name
          );


        const target =
          PRODUCT_TANKS.find(
            (tank) =>
              normalizeWarehouseCode(
                tank
              ) === code
          );


        if (!target) {

          console.log(
            '[WAREHOUSE DI SKIP]',
            warehouse
          );

          return;

        }


        const qty =
          toNumber(
            warehouse.quantity
          ) ?? 0;


        const available =
          toNumber(
            warehouse.quantity_available
          ) ??
          qty;


        map[
          normalizeKey(target)
        ] = {

          type:
            'product',

          label:
            target,

          code:
            target,

          name:
            product.name ||
            'Produk',

          qty:
            qty,

          availableQty:
            available,

          unit:
            product.unit ||
            'Liter',

          productId:
            product.id,

          sku:
            product.sku,

          warehouseId:
            warehouse.id ??
            null,

          warehouse:
            warehouse,

          status:
            getStatus(
              qty
            )

        };

      }
    );


    // ----------------------------------------------------------
    // Render semua
    // ----------------------------------------------------------

    el.productGrid.innerHTML =
      '';


    PRODUCT_TANKS.forEach(
      (tank) => {

        const item =
          map[
            normalizeKey(tank)
          ];


        el.productGrid.appendChild(
          buildCard(item)
        );

      }
    );


    console.log(
      '[DASHBOARD STOCK]'
    );


    PRODUCT_TANKS.forEach(
      (tank) => {

        const item =
          map[
            normalizeKey(tank)
          ];


        console.log(
          tank,
          '=>',
          item.qty,
          item.unit
        );

      }
    );

  }


  // ============================================================
  // CARD
  // ============================================================

  function buildCard(
    item
  ) {

    const card =
      document.createElement(
        'div'
      );


    card.className =
      'tank-card';


    card.dataset.id =
      item.label ||
      item.code ||
      '';


    const qty =
      toNumber(
        item.qty
      ) ?? 0;


    const available =
      toNumber(
        item.availableQty
      ) ?? qty;


    const status =
      item.status ||
      getStatus(qty);


    card.innerHTML = `

      <span
        class="status-dot status-${escapeHtml(status)}"
      ></span>

      <div class="code">
        ${escapeHtml(
          item.label ||
          item.code ||
          '-'
        )}
      </div>

      <div class="item-name">
        ${escapeHtml(
          item.name ||
          '-'
        )}
      </div>

      <div class="qty-line">

        <span class="qty-value">
          ${escapeHtml(
            formatNumber(qty)
          )}
        </span>

        <span class="qty-unit">
          ${escapeHtml(
            item.unit ||
            'Liter'
          )}
        </span>

      </div>

      <div class="available-line">

        Available:

        <strong>
          ${escapeHtml(
            formatNumber(
              available
            )
          )}
        </strong>

      </div>

    `;


    card.addEventListener(
      'click',
      () => {

        openDetailModal(
          item
        );

      }
    );


    return card;

  }


  // ============================================================
  // MODAL
  // ============================================================

  function openDetailModal(
    item
  ) {

    currentProduct =
      item;


    el.modalTitle.textContent =
      item.label ||
      item.name ||
      'Detail';


    el.opnameQtyFisik.value =
      '';

    el.opnameNote.value =
      '';

    el.opnameSelisih.textContent =
      '-';


    el.opnameMessage.classList.add(
      'hidden'
    );


    renderModalBody(
      item
    );


    el.opnameQtySistem.textContent =
      formatQtyUnit(
        item.qty ?? 0,
        item.unit || 'Liter'
      );


    show(
      el.modal
    );

  }


  function renderModalBody(
    item
  ) {

    const rows = [

      [
        'Produk',
        item.name
      ],

      [
        'Kode Tank',
        item.label
      ],

      [
        'SKU',
        item.sku || '-'
      ],

      [
        'Warehouse ID',
        item.warehouseId || '-'
      ],

      [
        'Qty Sistem',
        formatQtyUnit(
          item.qty ?? 0,
          item.unit || 'Liter'
        )
      ],

      [
        'Qty Available',
        formatQtyUnit(
          item.availableQty ?? 0,
          item.unit || 'Liter'
        )
      ]

    ];


    el.modalBody.innerHTML =
      rows
        .map(
          ([label, value]) => `

            <div class="detail-row">

              <span class="label">
                ${escapeHtml(
                  label
                )}
              </span>

              <span class="value">
                ${escapeHtml(
                  String(value)
                )}
              </span>

            </div>

          `
        )
        .join('');

  }


  function closeModal() {

    hide(
      el.modal
    );

    currentProduct =
      null;

  }


  el.modalClose?.addEventListener(
    'click',
    closeModal
  );


  el.modal?.addEventListener(
    'click',
    (event) => {

      if (
        event.target ===
        el.modal
      ) {

        closeModal();

      }

    }
  );


  // ============================================================
  // OPNAME
  // ============================================================

  el.opnameQtyFisik?.addEventListener(
    'input',
    () => {

      if (!currentProduct) {
        return;
      }


      const fisik =
        Number(
          el.opnameQtyFisik.value
        );


      if (!Number.isFinite(fisik)) {

        el.opnameSelisih.textContent =
          '-';

        return;

      }


      const sistem =
        toNumber(
          currentProduct.qty
        ) ?? 0;


      const selisih =
        fisik -
        sistem;


      el.opnameSelisih.textContent =
        formatQtyUnit(
          selisih,
          currentProduct.unit ||
            'Liter',
          true
        );

    }
  );


  // ============================================================
  // ADJUSTMENT
  // ============================================================

  el.opnameForm?.addEventListener(
    'submit',
    (event) => {

      event.preventDefault();


      el.opnameMessage.classList.remove(
        'hidden',
        'success',
        'error'
      );


      el.opnameMessage.classList.add(
        'error'
      );


      el.opnameMessage.textContent =
        'Stock Adjustment belum diaktifkan. Tahap ini masih READ-ONLY.';

    }
  );


  el.confirmCancel?.addEventListener(
    'click',
    () => {

      hide(
        el.confirmModal
      );

    }
  );


  // ============================================================
  // REFRESH
  // ============================================================

  el.refreshBtn?.addEventListener(
    'click',
    loadDashboard
  );


  // ============================================================
  // UI
  // ============================================================

  function setLoading(
    isLoading
  ) {

    el.loadingBar?.classList.toggle(
      'hidden',
      !isLoading
    );


    el.refreshBtn?.classList.toggle(
      'spinning',
      isLoading
    );


    if (
      el.refreshBtn
    ) {

      el.refreshBtn.disabled =
        isLoading;

    }

  }


  function updateLastUpdate() {

    if (
      !el.lastUpdate
    ) {
      return;
    }


    el.lastUpdate.textContent =
      new Date().toLocaleTimeString(
        'id-ID',
        {
          hour12: false
        }
      );

  }


  function showGlobalError(
    message
  ) {

    if (
      !el.globalError
    ) {
      return;
    }


    el.globalError.textContent =
      message;


    el.globalError.classList.remove(
      'hidden'
    );

  }


  function hideGlobalError() {

    el.globalError?.classList.add(
      'hidden'
    );

  }


  // ============================================================
  // HELPERS
  // ============================================================

  function show(node) {

    node?.classList.remove(
      'hidden'
    );

  }


  function hide(node) {

    node?.classList.add(
      'hidden'
    );

  }


  function toNumber(
    value
  ) {

    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {

      return null;

    }


    const n =
      Number(value);


    return Number.isFinite(n)
      ? n
      : null;

  }


  function formatNumber(
    value
  ) {

    const n =
      toNumber(value) ?? 0;


    return n.toLocaleString(
      'id-ID',
      {
        maximumFractionDigits: 2
      }
    );

  }


  function formatQtyUnit(
    value,
    unit,
    signed
  ) {

    const n =
      toNumber(value) ?? 0;


    const sign =
      signed &&
      n > 0
        ? '+'
        : '';


    return (
      sign +
      formatNumber(n) +
      (
        unit
          ? ` ${unit}`
          : ''
      )
    );

  }


  function getStatus(
    qty
  ) {

    const n =
      toNumber(qty) ?? 0;


    if (
      n <= 0
    ) {

      return 'grey';

    }


    return 'green';

  }


  function normalizeKey(
    value
  ) {

    return String(
      value || ''
    )
      .toUpperCase()
      .replace(
        /[^A-Z0-9]/g,
        ''
      );

  }


  // TK-1
  // TK-01
  // TK1
  // -> TK1

  function normalizeWarehouseCode(
    value
  ) {

    const key =
      normalizeKey(value);


    const match =
      key.match(
        /^TK0*(\d+)$/
      );


    if (
      match
    ) {

      return `TK${Number(match[1])}`;

    }


    return key;

  }


  function escapeHtml(
    value
  ) {

    if (
      value === null ||
      value === undefined
    ) {

      return '';

    }


    return String(value)

      .replace(
        /&/g,
        '&amp;'
      )

      .replace(
        /</g,
        '&lt;'
      )

      .replace(
        />/g,
        '&gt;'
      )

      .replace(
        /"/g,
        '&quot;'
      )

      .replace(
        /'/g,
        '&#39;'
      );

  }


  // ============================================================
  // START
  // ============================================================

  loadDashboard();


  setInterval(
    loadDashboard,
    REFRESH_INTERVAL_MS
  );

})();
