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

  const TIRISAN_TANKS = [
    'V-01',
    'V-02',
    'V-03',
    'V-04',
    'V-05',
    'V-06',
    'V-07',
    'V-08',
    'TPS',
    'Tangki IBC (Kempu)',
    'Bak Basa'
  ];

  // ============================================================
  // ELEMENT
  // ============================================================

  const el = {
    rawGrid: document.getElementById('rawMaterialsGrid'),
    productGrid: document.getElementById('productsGrid'),
    tirisanGrid: document.getElementById('tirisanGrid'),

    lastUpdate: document.getElementById('lastUpdate'),

    logBahan: document.getElementById('logBahan'),
    logProduk: document.getElementById('logProduk'),

    summaryProduk: document.getElementById('summaryProduk'),
    summaryBahanBaku: document.getElementById('summaryBahanBaku'),
    summaryTirisan: document.getElementById('summaryTirisan'),

    refreshBtn: document.getElementById('refreshBtn'),
    loadingBar: document.getElementById('loadingBar'),
    globalError: document.getElementById('globalError'),

    modal: document.getElementById('detailModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.getElementById('modalClose'),

    opnameForm: document.getElementById('opnameForm'),
    opnameQtySistem: document.getElementById('opnameQtySistem'),
    opnameQtyFisik: document.getElementById('opnameQtyFisik'),
    opnameSelisih: document.getElementById('opnameSelisih'),
    opnameNote: document.getElementById('opnameNote'),
    opnameMessage: document.getElementById('opnameMessage'),

    confirmModal: document.getElementById('confirmModal'),
    confirmCancel: document.getElementById('confirmCancel')
  };

  let isFetching = false;
  let currentProduct = null;

  let salesPage = 1;
  let isLoadingSales = false;

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

    try {
      // Master tangki tetap ditampilkan saat data dimuat.
      renderRawMaterials();
      renderProductMaster();
      renderTirisanMaster();

      try {
        const {
          categories,
          unconfigured
        } = await fetchStock();

        renderStock(categories);
        updateLastUpdate();

        if (unconfigured.length) {
          showGlobalError(
            'Kategori belum terhubung ke Mekari: ' +
            unconfigured.join(', ') +
            '. Isi product ID-nya di .env server lalu restart.'
          );
        } else {
          hideGlobalError();
        }
      } catch (err) {
        console.error('[Dashboard]', err);

        renderRawMaterials();
        renderProductMaster();
        renderTirisanMaster();

        setSummaryValue(el.summaryProduk, null);
        setSummaryValue(el.summaryBahanBaku, null);
        setSummaryValue(el.summaryTirisan, null);

        showGlobalError(
          err.message ||
          'Gagal mengambil data dari Mekari Jurnal.'
        );
      }

      // Log tetap dicoba meskipun pengambilan stok gagal.
      await loadMovements();
    } finally {
      isFetching = false;
      setLoading(false);
    }
  }

  // ============================================================
  // FETCH JSON
  // ============================================================

  async function fetchApi(url) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    let body;

    try {
      body = await response.json();
    } catch (err) {
      throw new Error(
        `Response server bukan JSON yang valid (HTTP ${response.status}).`
      );
    }

    if (!response.ok || !body.success) {
      const message =
        typeof body.error === 'string'
          ? body.error
          : body.error?.message;

      throw new Error(
        message ||
        `Permintaan gagal (HTTP ${response.status}).`
      );
    }

    return body;
  }

  // ============================================================
  // FETCH STOCK
  // ============================================================

  async function fetchStock() {
    const body = await fetchApi('/api/stock');

    return {
      categories: Array.isArray(body.data?.categories)
        ? body.data.categories
        : [],

      unconfigured: Array.isArray(body.unconfigured)
        ? body.unconfigured
        : []
    };
  }

  // ============================================================
  // LOAD LOG
  // ============================================================

  async function loadMovements() {
    await Promise.all([
      loadMovementsInto(
        el.logBahan,
        'raw',
        'Belum ada transaksi bahan baku.'
      ),

      loadLogKeluar()
    ]);
  }

  // ============================================================
  // LOG PRODUK KELUAR
  //
  // Data dari Sales Invoice Jurnal.
  // Filter ATL-Pro dan ATL-Diesel dilakukan server.cjs.
  // Satu halaman memeriksa maksimal 30 invoice.
  // ============================================================

  async function loadLogKeluar(page = salesPage) {
    const container = el.logProduk;

    if (!container || isLoadingSales) {
      return;
    }

    isLoadingSales = true;

    container.setAttribute('aria-busy', 'true');

    container.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });

    try {
      const body = await fetchApi(
        `/api/log-keluar?limit=10&page=${page}`
      );

      if (!Array.isArray(body.data)) {
        throw new Error('Format data sales dari server tidak valid.');
      }

      salesPage = page;

      renderLogKeluar(
        container,
        body.data
      );

      renderSalesPagination(
        container,
        body.meta || {},
        page
      );
    } catch (err) {
      console.error('[Log Keluar]', err);

      container.innerHTML = `
        <div class="empty-state">
          ${escapeHtml(
            err.message ||
            'Log produk keluar belum bisa dimuat.'
          )}
        </div>
      `;

      const retryWrap = document.createElement('div');

      retryWrap.className = 'empty-state';

      const retryButton = document.createElement('button');

      retryButton.type = 'button';
      retryButton.textContent = 'Coba lagi';
      retryButton.style.margin = '8px';

      retryButton.addEventListener('click', () => {
        loadLogKeluar(page);
      });

      retryWrap.appendChild(retryButton);
      container.appendChild(retryWrap);
    } finally {
      isLoadingSales = false;
      container.setAttribute('aria-busy', 'false');
    }
  }

  function renderSalesPagination(container, meta, page) {
    const footer = document.createElement('div');

    footer.className = 'empty-state';

    const description = document.createElement('div');

    description.textContent =
      `Halaman ${page} · ` +
      `${meta.invoicesScanned ?? 0} invoice diperiksa.`;

    footer.appendChild(description);

    const note = document.createElement('div');

    note.textContent =
      'Berdasarkan faktur penjualan, bukan konfirmasi pengiriman fisik.';

    note.style.marginTop = '6px';
    note.style.fontSize = '12px';

    footer.appendChild(note);

    const navigation = [
      {
        label: 'Sebelumnya',
        target: page - 1,
        disabled: page <= 1
      },
      {
        label: 'Berikutnya',
        target: page + 1,
        disabled: !meta.hasNext
      }
    ];

    navigation.forEach((item) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.textContent = item.label;
      button.disabled = item.disabled;
      button.style.margin = '8px';

      button.addEventListener('click', () => {
        loadLogKeluar(item.target);
      });

      footer.appendChild(button);
    });

    container.appendChild(footer);
  }

  function renderLogKeluar(container, rows) {
    if (!rows.length) {
      container.innerHTML = `
        <div class="empty-state">
          Tidak ada penjualan ATL-Pro / ATL-Diesel
          pada halaman invoice ini.
        </div>
      `;

      return;
    }

    container.innerHTML = rows.map((row) => {
      const dateLabel = formatTransactionDate(row.date);

      const sub = [
        dateLabel,
        row.invoiceNumber,
        row.customer,

        row.warehouse && row.warehouse !== '-'
          ? row.warehouse
          : ''
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');

      return `
        <div class="log-entry">

          <div class="log-main">

            <div class="log-title">
              ${escapeHtml(row.productName || '-')}
              · KELUAR
            </div>

            <div class="log-sub">
              ${sub}
            </div>

          </div>

          <div class="log-qty out">
            -${escapeHtml(
              formatQtyUnit(
                row.quantity,
                row.unit || 'Liter'
              )
            )}
          </div>

        </div>
      `;
    }).join('');
  }

  // ============================================================
  // LOG BAHAN / MOVEMENT
  // ============================================================

  async function loadMovementsInto(
    container,
    category,
    emptyMessage
  ) {
    if (!container) {
      return;
    }

    try {
      const body = await fetchApi(
        `/api/movements?category=${encodeURIComponent(category)}&limit=20`
      );

      renderMovements(
        container,
        Array.isArray(body.data) ? body.data : [],
        emptyMessage
      );
    } catch (err) {
      console.error('[Movements]', category, err);

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
    if (!Array.isArray(rows) || !rows.length) {
      container.innerHTML = `
        <div class="empty-state">
          ${escapeHtml(emptyMessage)}
        </div>
      `;

      return;
    }

    container.innerHTML = rows.map((row) => {
      const qtyNum = toNumber(row.quantity) ?? 0;

      const direction =
        qtyNum > 0
          ? 'in'
          : qtyNum < 0
            ? 'out'
            : 'neutral';

      const dateLabel = formatTransactionDate(row.date);

      return `
        <div class="log-entry">

          <div class="log-main">

            <div class="log-title">
              ${escapeHtml(row.productName || '-')}

              ${
                row.type
                  ? ' · ' + escapeHtml(row.type)
                  : ''
              }
            </div>

            <div class="log-sub">
              ${escapeHtml(dateLabel)}

              ${
                row.warehouse && row.warehouse !== '-'
                  ? ' · ' + escapeHtml(row.warehouse)
                  : ''
              }

              ${
                row.note
                  ? ' · ' + escapeHtml(row.note)
                  : ''
              }
            </div>

          </div>

          <div class="log-qty ${direction}">
            ${escapeHtml(
              formatQtyUnit(
                qtyNum,
                row.unit || 'Liter',
                true
              )
            )}
          </div>

        </div>
      `;
    }).join('');
  }

  // ============================================================
  // BAHAN BAKU MASTER
  // ============================================================

  function renderRawMaterials() {
    if (!el.rawGrid) {
      return;
    }

    el.rawGrid.innerHTML = '';

    RAW_TANKS.forEach((tank) => {
      el.rawGrid.appendChild(
        buildCard({
          type: 'raw',
          label: tank,
          code: tank,
          name: 'Bahan Baku',
          qty: 0,
          availableQty: 0,
          unit: 'Liter',
          status: 'grey'
        })
      );
    });
  }

  // ============================================================
  // PRODUCT MASTER
  // ============================================================

  function renderProductMaster() {
    if (!el.productGrid) {
      return;
    }

    el.productGrid.innerHTML = '';

    PRODUCT_TANKS.forEach((tank) => {
      el.productGrid.appendChild(
        buildCard({
          type: 'product',
          label: tank,
          code: tank,
          name: 'Produk',
          qty: 0,
          availableQty: 0,
          unit: 'Liter',
          status: 'grey',
          warehouseId: null
        })
      );
    });
  }

  // ============================================================
  // TIRISAN MASTER
  // ============================================================

  function renderTirisanMaster() {
    if (!el.tirisanGrid) {
      return;
    }

    el.tirisanGrid.innerHTML = '';

    TIRISAN_TANKS.forEach((tank) => {
      el.tirisanGrid.appendChild(
        buildCard({
          type: 'tirisan',
          label: tank,
          code: tank,
          name: 'Tirisan Produk',
          qty: 0,
          availableQty: 0,
          unit: 'Liter',
          status: 'grey',
          warehouseId: null
        })
      );
    });
  }

  // ============================================================
  // RENDER STOCK
  //
  // Zona tampilan mengikuti kode tangki fisik.
  // Nama dan quantity mengikuti produk pada warehouse.
  // ============================================================

  function renderStock(categories) {
    function classifyTankCode(code) {
      const trimmed = String(code).trim();

      if (
        RAW_TANKS.some((tank) => {
          return normalizeKey(tank) === normalizeKey(code);
        }) ||
        /^ST[-_]?\d/i.test(trimmed)
      ) {
        return 'raw';
      }

      if (
        TIRISAN_TANKS.some((tank) => {
          return normalizeKey(tank) === normalizeKey(code);
        }) ||
        /^V[-_]?0*[1-8]$/i.test(trimmed) ||
        /^TPS$/i.test(trimmed) ||
        /IBC/i.test(trimmed) ||
        /KEMPU/i.test(trimmed) ||
        /BAK\s*BASA/i.test(trimmed)
      ) {
        return 'tirisan';
      }

      return 'product';
    }

    const map = Object.create(null);
    const order = [];

    // ----------------------------------------------------------
    // Tangki master ditambahkan dahulu.
    // ----------------------------------------------------------

    RAW_TANKS
      .concat(PRODUCT_TANKS)
      .concat(TIRISAN_TANKS)
      .forEach((tank) => {
        const type = classifyTankCode(tank);
        const key = normalizeKey(tank);

        const defaultName =
          type === 'raw'
            ? 'Bahan Baku'
            : type === 'tirisan'
              ? 'Tirisan Produk'
              : 'Produk';

        map[key] = {
          type,
          label: tank,
          code: tank,
          name: defaultName,
          qty: 0,
          availableQty: 0,
          unit: 'Liter',
          productId: null,
          sku: null,
          warehouseId: null,
          status: 'grey'
        };

        order.push(key);
      });

    // ----------------------------------------------------------
    // Kumpulkan warehouse dari semua kategori.
    // ----------------------------------------------------------

    const candidates = Object.create(null);

    categories.forEach((category) => {
      const warehouses = Array.isArray(category.warehouses)
        ? category.warehouses
        : [];

      warehouses.forEach((warehouse) => {
        const rawCode = String(
          warehouse.code ||
          warehouse.name ||
          ''
        ).trim();

        if (!rawCode) {
          console.log(
            '[WAREHOUSE TANPA KODE DI SKIP]',
            category.label,
            warehouse
          );

          return;
        }

        const key = normalizeKey(rawCode);

        const qty =
          toNumber(warehouse.quantity) ?? 0;

        const available =
          toNumber(warehouse.quantity_available) ?? qty;

        if (!candidates[key]) {
          candidates[key] = [];
        }

        candidates[key].push({
          code: rawCode,
          category,
          warehouse,
          qty,
          available
        });

        // Tangki baru dari Mekari ikut ditampilkan.
        if (!map[key]) {
          const type = classifyTankCode(rawCode);

          const defaultName =
            type === 'raw'
              ? 'Bahan Baku'
              : type === 'tirisan'
                ? 'Tirisan Produk'
                : 'Produk';

          map[key] = {
            type,
            label: rawCode,
            code: rawCode,
            name: defaultName,
            qty: 0,
            availableQty: 0,
            unit: 'Liter',
            productId: null,
            sku: null,
            warehouseId: null,
            status: 'grey'
          };

          order.push(key);
        }
      });
    });

    // ----------------------------------------------------------
    // Mempertahankan aturan stok kode awal:
    // satu kategori ditampilkan untuk setiap tangki.
    //
    // Jika beberapa kategori berisi pada tangki yang sama,
    // pilih quantity absolut terbesar dan tulis peringatan.
    // ----------------------------------------------------------

    Object.keys(candidates).forEach((key) => {
      const list = candidates[key];

      const filled = list.filter((candidate) => {
        return candidate.qty !== 0;
      });

      let winner;

      if (filled.length === 1) {
        winner = filled[0];
      } else if (filled.length > 1) {
        winner = filled.reduce((a, b) => {
          return Math.abs(b.qty) > Math.abs(a.qty)
            ? b
            : a;
        });

        console.warn(
          '[KONFLIK TANGKI]',
          winner.code,
          'ada isi di lebih dari satu kategori:',
          filled.map((candidate) => {
            return (
              candidate.category.label +
              '=' +
              candidate.qty
            );
          }).join(', ')
        );
      } else {
        winner = list[0];
      }

      const type = classifyTankCode(winner.code);

      map[key] = {
        type,

        label: winner.code,
        code: winner.code,

        name:
          winner.category.label ||
          winner.category.name ||
          'Produk',

        qty: winner.qty,
        availableQty: winner.available,

        unit: winner.category.unit || 'Liter',

        productId: winner.category.productId,
        sku: winner.category.sku,

        warehouseId: winner.warehouse.id ?? null,
        warehouse: winner.warehouse,

        status: getStatus(winner.qty)
      };
    });

    // ----------------------------------------------------------
    // Render grid.
    // ----------------------------------------------------------

    if (el.rawGrid) {
      el.rawGrid.innerHTML = '';
    }

    if (el.productGrid) {
      el.productGrid.innerHTML = '';
    }

    if (el.tirisanGrid) {
      el.tirisanGrid.innerHTML = '';
    }

    const zoneTotals = {
      raw: 0,
      product: 0,
      tirisan: 0
    };

    order.forEach((key) => {
      const item = map[key];

      zoneTotals[item.type] += item.qty;

      if (item.type === 'raw') {
        if (el.rawGrid) {
          el.rawGrid.appendChild(buildCard(item));
        }
      } else if (item.type === 'tirisan') {
        if (el.tirisanGrid) {
          el.tirisanGrid.appendChild(buildCard(item));
        }
      } else {
        if (el.productGrid) {
          el.productGrid.appendChild(buildCard(item));
        }
      }
    });

    console.log('[DASHBOARD STOCK]');

    order.forEach((key) => {
      const item = map[key];

      console.log(
        item.code,
        '=>',
        item.name,
        item.qty,
        item.unit
      );
    });

    renderSummaryTotals(zoneTotals);
  }

  // ============================================================
  // SUMMARY TOTALS
  // ============================================================

  function renderSummaryTotals(zoneTotals) {
    setSummaryValue(
      el.summaryProduk,
      zoneTotals.product
    );

    setSummaryValue(
      el.summaryBahanBaku,
      zoneTotals.raw
    );

    setSummaryValue(
      el.summaryTirisan,
      zoneTotals.tirisan
    );
  }

  function setSummaryValue(node, total) {
    if (!node) {
      return;
    }

    if (total === undefined || total === null) {
      node.textContent = '-';
      return;
    }

    node.textContent = formatQtyUnit(
      total,
      'Liter'
    );
  }

  // ============================================================
  // CARD
  // ============================================================

  function buildCard(item) {
    const card = document.createElement('div');

    card.className = 'tank-card';

    card.dataset.id =
      item.label ||
      item.code ||
      '';

    const qty = toNumber(item.qty) ?? 0;

    const available =
      toNumber(item.availableQty) ?? qty;

    const status =
      item.status ||
      getStatus(qty);

    card.classList.add(`tank-status-${status}`);

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
        ${escapeHtml(item.name || '-')}
      </div>

      <div class="qty-line">

        <span class="qty-value">
          ${escapeHtml(formatNumber(qty))}
        </span>

        <span class="qty-unit">
          ${escapeHtml(item.unit || 'Liter')}
        </span>

      </div>

      <div class="available-line">
        Available:

        <strong>
          ${escapeHtml(formatNumber(available))}
        </strong>
      </div>
    `;

    card.addEventListener('click', () => {
      openDetailModal(item);
    });

    return card;
  }

  // ============================================================
  // MODAL
  // ============================================================

  function openDetailModal(item) {
    if (!el.modal) {
      return;
    }

    currentProduct = item;

    if (el.modalTitle) {
      el.modalTitle.textContent =
        item.label ||
        item.name ||
        'Detail';
    }

    if (el.opnameQtyFisik) {
      el.opnameQtyFisik.value = '';
    }

    if (el.opnameNote) {
      el.opnameNote.value = '';
    }

    if (el.opnameSelisih) {
      el.opnameSelisih.textContent = '-';
    }

    el.opnameMessage?.classList.add('hidden');

    renderModalBody(item);

    if (el.opnameQtySistem) {
      el.opnameQtySistem.textContent = formatQtyUnit(
        item.qty ?? 0,
        item.unit || 'Liter'
      );
    }

    show(el.modal);
  }

  function renderModalBody(item) {
    if (!el.modalBody) {
      return;
    }

    const rows = [
      [
        'Produk',
        item.name || '-'
      ],
      [
        'Kode Tank',
        item.label || '-'
      ],
      [
        'SKU',
        item.sku || '-'
      ],
      [
        'Warehouse ID',
        item.warehouseId ?? '-'
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

    el.modalBody.innerHTML = rows.map(([label, value]) => {
      return `
        <div class="detail-row">

          <span class="label">
            ${escapeHtml(label)}
          </span>

          <span class="value">
            ${escapeHtml(String(value))}
          </span>

        </div>
      `;
    }).join('');
  }

  function closeModal() {
    hide(el.modal);
    currentProduct = null;
  }

  el.modalClose?.addEventListener(
    'click',
    closeModal
  );

  el.modal?.addEventListener('click', (event) => {
    if (event.target === el.modal) {
      closeModal();
    }
  });

  // ============================================================
  // OPNAME
  // ============================================================

  el.opnameQtyFisik?.addEventListener('input', () => {
    if (!currentProduct || !el.opnameSelisih) {
      return;
    }

    const inputValue = el.opnameQtyFisik.value.trim();

    if (inputValue === '') {
      el.opnameSelisih.textContent = '-';
      return;
    }

    const fisik = Number(inputValue);

    if (!Number.isFinite(fisik)) {
      el.opnameSelisih.textContent = '-';
      return;
    }

    const sistem =
      toNumber(currentProduct.qty) ?? 0;

    const selisih = fisik - sistem;

    el.opnameSelisih.textContent = formatQtyUnit(
      selisih,
      currentProduct.unit || 'Liter',
      true
    );
  });

  // ============================================================
  // ADJUSTMENT
  // ============================================================

  el.opnameForm?.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!el.opnameMessage) {
      return;
    }

    el.opnameMessage.classList.remove(
      'hidden',
      'success',
      'error'
    );

    el.opnameMessage.classList.add('error');

    el.opnameMessage.textContent =
      'Stock Adjustment belum diaktifkan. ' +
      'Tahap ini masih READ-ONLY.';
  });

  el.confirmCancel?.addEventListener('click', () => {
    hide(el.confirmModal);
  });

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

  function setLoading(isLoading) {
    el.loadingBar?.classList.toggle(
      'hidden',
      !isLoading
    );

    el.refreshBtn?.classList.toggle(
      'spinning',
      isLoading
    );

    if (el.refreshBtn) {
      el.refreshBtn.disabled = isLoading;
    }
  }

  function updateLastUpdate() {
    if (!el.lastUpdate) {
      return;
    }

    el.lastUpdate.textContent = formatDateTime(
      new Date()
    );
  }

  function formatDateTime(date) {
    if (
      !(date instanceof Date) ||
      Number.isNaN(date.getTime())
    ) {
      return '-';
    }

    const datePart = date.toLocaleDateString(
      'id-ID',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );

    const pad = (number) => {
      return String(number).padStart(2, '0');
    };

    const timePart =
      `${pad(date.getHours())}:` +
      `${pad(date.getMinutes())}:` +
      `${pad(date.getSeconds())}`;

    return `${datePart}, ${timePart}`;
  }

  function formatTransactionDate(value) {
    if (!value) {
      return '-';
    }

    const text = String(value).trim();

    // Tanggal invoice tidak diberi jam buatan.
    const isoDate = text.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

    const slashDate = text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );

    let date;

    if (isoDate) {
      date = new Date(
        Number(isoDate[1]),
        Number(isoDate[2]) - 1,
        Number(isoDate[3])
      );
    } else if (slashDate) {
      date = new Date(
        Number(slashDate[3]),
        Number(slashDate[2]) - 1,
        Number(slashDate[1])
      );
    } else {
      date = new Date(text);

      return Number.isNaN(date.getTime())
        ? text
        : formatDateTime(date);
    }

    return date.toLocaleDateString(
      'id-ID',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );
  }

  function showGlobalError(message) {
    if (!el.globalError) {
      return;
    }

    el.globalError.textContent = message;
    el.globalError.classList.remove('hidden');
  }

  function hideGlobalError() {
    el.globalError?.classList.add('hidden');
  }

  // ============================================================
  // HELPERS
  // ============================================================

  function show(node) {
    node?.classList.remove('hidden');
  }

  function hide(node) {
    node?.classList.add('hidden');
  }

  function toNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : null;
  }

  function formatNumber(value) {
    const number = toNumber(value) ?? 0;

    return number.toLocaleString(
      'id-ID',
      {
        maximumFractionDigits: 2
      }
    );
  }

  function formatQtyUnit(value, unit, signed) {
    const number = toNumber(value) ?? 0;

    const sign =
      signed && number > 0
        ? '+'
        : '';

    return (
      sign +
      formatNumber(number) +
      (
        unit
          ? ` ${unit}`
          : ''
      )
    );
  }

  function getStatus(qty) {
    const number = toNumber(qty) ?? 0;

    if (number <= 0) {
      return 'grey';
    }

    return 'green';
  }

  function normalizeKey(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  // Helper dari kode awal dipertahankan.
  function normalizeWarehouseCode(value) {
    const key = normalizeKey(value);

    const match = key.match(
      /^TK0*(\d+)$/
    );

    if (match) {
      return `TK${Number(match[1])}`;
    }

    return key;
  }

  function escapeHtml(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return '';
    }

    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
