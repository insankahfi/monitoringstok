(function () {
  'use strict';

  const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

    logBahan:
      document.getElementById(
        'logBahan'
      ),

    logProduk:
      document.getElementById(
        'logProduk'
      ),

    summarySolarHsd:
      document.getElementById(
        'summarySolarHsd'
      ),

    summarySolarMurni:
      document.getElementById(
        'summarySolarMurni'
      ),

    summaryBahanBaku:
      document.getElementById(
        'summaryBahanBaku'
      ),

    summaryTirisan:
      document.getElementById(
        'summaryTirisan'
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

      const {
        categories,
        unconfigured
      } = await fetchStock();


      renderStock(
        categories
      );


      updateLastUpdate();


      if (
        unconfigured &&
        unconfigured.length
      ) {

        showGlobalError(
          `Kategori belum terhubung ke Mekari: ${unconfigured.join(', ')}. ` +
          `Isi product ID-nya di .env server lalu restart.`
        );

      } else {

        hideGlobalError();

      }


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


    }


    // Log tidak boleh menggagalkan dashboard utama.
    try {

      await loadMovements();

    } catch (err) {

      console.error(
        '[Movements]',
        err
      );

    }


    isFetching = false;

    setLoading(false);

  }


  // ============================================================
  // FETCH STOCK (SEMUA KATEGORI SEKALIGUS)
  // ============================================================

  async function fetchStock() {

    const res =
      await fetch(
        '/api/stock'
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
        'Gagal mengambil data stok.'
      );

    }


    if (!body.success) {

      throw new Error(
        body.error ||
        'Mekari tidak mengembalikan data stok.'
      );

    }


    return {

      categories:
        Array.isArray(
          body.data?.categories
        )
          ? body.data.categories
          : [],

      unconfigured:
        Array.isArray(body.unconfigured)
          ? body.unconfigured
          : []

    };

  }


  // ============================================================
  // MOVEMENTS / TRANSACTION LIST
  // ============================================================

  async function loadMovements() {

    await Promise.all([

      loadMovementsInto(
        el.logBahan,
        'raw',
        'Belum ada transaksi bahan baku.'
      ),

      loadMovementsInto(
        el.logProduk,
        'product',
        'Belum ada transaksi produk.'
      )

    ]);

  }


  async function loadMovementsInto(
    container,
    category,
    emptyMessage
  ) {

    if (!container) {
      return;
    }


    try {

      const res =
        await fetch(
          `/api/movements?category=${category}&limit=20`
        );


      const body =
        await res.json();


      if (
        !res.ok ||
        !body.success
      ) {

        throw new Error(
          body.error ||
          'Gagal mengambil transaksi.'
        );

      }


      renderMovements(
        container,
        body.data || [],
        emptyMessage
      );


    } catch (err) {

      console.error(
        '[Movements]',
        category,
        err
      );


      container.innerHTML = `
        <div class="empty-state">
          ${escapeHtml(
            err.message ||
            'Transaksi belum bisa dimuat.'
          )}
        </div>
      `;

    }

  }


  function renderMovements(
    container,
    rows,
    emptyMessage
  ) {

    if (
      !Array.isArray(rows) ||
      !rows.length
    ) {

      container.innerHTML = `
        <div class="empty-state">
          ${escapeHtml(emptyMessage)}
        </div>
      `;

      return;

    }


    container.innerHTML =
      rows
        .map(
          (row) => {

            const qtyNum =
              toNumber(row.quantity) ?? 0;


            const direction =
              qtyNum > 0
                ? 'in'
                : qtyNum < 0
                  ? 'out'
                  : 'neutral';


            const dateLabel =
              row.date
                ? formatDateTime(
                    new Date(row.date)
                  )
                : '-';


            return `

              <div class="log-entry">

                <div class="log-main">

                  <div class="log-title">
                    ${escapeHtml(
                      row.productName || '-'
                    )}
                    ${
                      row.type
                        ? ' · ' + escapeHtml(row.type)
                        : ''
                    }
                  </div>

                  <div class="log-sub">
                    ${escapeHtml(dateLabel)}
                    ${
                      row.warehouse &&
                      row.warehouse !== '-'
                        ? ' · ' + escapeHtml(row.warehouse)
                        : ''
                    }
                  </div>

                </div>

                <div class="log-qty ${direction}">
                  ${formatQtyUnit(
                    qtyNum,
                    row.unit || 'Liter',
                    true
                  )}
                </div>

              </div>

            `;

          }
        )
        .join('');

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
  // RENDER STOCK (SEMUA KATEGORI)
  //
  // Setiap tangki (ST-xx / FST-xx / TK-xx / WT-xx) diisi dari
  // warehouse yang benar-benar cocok kodenya, ambil dari
  // kategori manapun yang punya warehouse itu (Bahan Baku,
  // Solar HSD, atau Solar Murni) — bukan dari satu produk yang
  // di-hardcode ke semua tangki.
  // ============================================================

  function renderStock(
    categories
  ) {

    const allTanks =
      RAW_TANKS.concat(
        PRODUCT_TANKS
      );


    const map =
      {};


    // ----------------------------------------------------------
    // Default kosong untuk semua tangki dulu.
    // ----------------------------------------------------------

    allTanks.forEach(
      (tank) => {

        const isRaw =
          RAW_TANKS.includes(tank);

        map[
          normalizeKey(tank)
        ] = {

          type:
            isRaw ? 'raw' : 'product',

          label:
            tank,

          code:
            tank,

          name:
            isRaw ? 'Bahan Baku' : 'Produk',

          qty:
            0,

          availableQty:
            0,

          unit:
            'Liter',

          productId:
            null,

          sku:
            null,

          warehouseId:
            null,

          status:
            'grey'

        };

      }
    );


    // ----------------------------------------------------------
    // Kumpulkan dulu semua kandidat per tangki dari tiap
    // kategori (satu tangki bisa muncul di data 3 kategori
    // sekaligus, biasanya cuma satu yang ada isinya).
    // ----------------------------------------------------------

    const candidates =
      {};

    categories.forEach(
      (category) => {

        (category.warehouses || []).forEach(
          (warehouse) => {

            const code =
              normalizeWarehouseCode(
                warehouse.code ||
                warehouse.name
              );


            const target =
              allTanks.find(
                (tank) =>
                  normalizeWarehouseCode(
                    tank
                  ) === code
              );


            if (!target) {

              console.log(
                '[WAREHOUSE DI SKIP]',
                category.label,
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


            const key =
              normalizeKey(target);


            if (!candidates[key]) {
              candidates[key] = [];
            }


            candidates[key].push({
              target,
              category,
              warehouse,
              qty,
              available
            });

          }
        );

      }
    );


    // ----------------------------------------------------------
    // Pilih SATU kategori pemenang per tangki: yang isinya
    // ada (qty != 0). Kalau semua kategori 0 di tangki itu,
    // tetap tampil kosong. Kalau lebih dari satu kategori
    // sama-sama ada isi di tangki yang sama (harusnya tidak
    // terjadi di dunia nyata), pakai yang qty-nya paling
    // besar dan catat sebagai konflik di console.
    // ----------------------------------------------------------

    Object.keys(candidates).forEach(
      (key) => {

        const list =
          candidates[key];

        const filled =
          list.filter(
            (c) => c.qty !== 0
          );


        let winner;

        if (filled.length === 1) {

          winner =
            filled[0];

        } else if (filled.length > 1) {

          winner =
            filled.reduce(
              (a, b) =>
                Math.abs(b.qty) > Math.abs(a.qty)
                  ? b
                  : a
            );

          console.warn(
            '[KONFLIK TANGKI]',
            winner.target,
            'ada isi di lebih dari satu kategori:',
            filled
              .map(
                (c) =>
                  `${c.category.label}=${c.qty}`
              )
              .join(', ')
          );

        } else {

          winner =
            list[0];

        }


        map[key] = {

          type:
            RAW_TANKS.includes(winner.target)
              ? 'raw'
              : 'product',

          label:
            winner.target,

          code:
            winner.target,

          name:
            winner.category.label ||
            winner.category.name ||
            'Produk',

          qty:
            winner.qty,

          availableQty:
            winner.available,

          unit:
            winner.category.unit ||
            'Liter',

          productId:
            winner.category.productId,

          sku:
            winner.category.sku,

          warehouseId:
            winner.warehouse.id ??
            null,

          warehouse:
            winner.warehouse,

          status:
            getStatus(
              winner.qty
            )

        };

      }
    );


    // ----------------------------------------------------------
    // Render dua grid.
    // ----------------------------------------------------------

    el.rawGrid.innerHTML =
      '';

    RAW_TANKS.forEach(
      (tank) => {

        el.rawGrid.appendChild(
          buildCard(
            map[normalizeKey(tank)]
          )
        );

      }
    );


    el.productGrid.innerHTML =
      '';

    PRODUCT_TANKS.forEach(
      (tank) => {

        el.productGrid.appendChild(
          buildCard(
            map[normalizeKey(tank)]
          )
        );

      }
    );


    console.log(
      '[DASHBOARD STOCK]'
    );

    allTanks.forEach(
      (tank) => {

        const item =
          map[normalizeKey(tank)];

        console.log(
          tank,
          '=>',
          item.name,
          item.qty,
          item.unit
        );

      }
    );


    renderSummaryTotals(
      categories
    );

  }


  // ============================================================
  // SUMMARY TOTALS (KOTAK KANAN ATAS)
  // ============================================================

  function renderSummaryTotals(
    categories
  ) {

    const totalsByKey =
      {};

    categories.forEach(
      (category) => {

        const total =
          (category.warehouses || [])
            .reduce(
              (sum, warehouse) =>
                sum +
                (toNumber(warehouse.quantity) ?? 0),
              0
            );

        totalsByKey[category.key] = {
          total,
          unit:
            category.unit ||
            'Liter'
        };

      }
    );


    setSummaryValue(
      el.summarySolarHsd,
      totalsByKey.solar_hsd
    );

    setSummaryValue(
      el.summarySolarMurni,
      totalsByKey.solar_murni
    );


    // Tirisan belum ada sumber data / tangki — biarkan "-".

  }


  function setSummaryValue(
    node,
    entry
  ) {

    if (!node) {
      return;
    }


    if (!entry) {

      node.textContent =
        '-';

      return;

    }


    node.textContent =
      formatQtyUnit(
        entry.total,
        entry.unit
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
      formatDateTime(
        new Date()
      );

  }


  function formatDateTime(
    date
  ) {

    const datePart =
      date.toLocaleDateString(
        'id-ID',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        }
      );


    const pad =
      (n) =>
        String(n).padStart(2, '0');


    const timePart =
      `${pad(date.getHours())}:` +
      `${pad(date.getMinutes())}:` +
      `${pad(date.getSeconds())}`;


    return `${datePart}, ${timePart}`;

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
