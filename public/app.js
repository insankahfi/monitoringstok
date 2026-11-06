(function () {
  'use strict';

  const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

  // ============================================================
  // MASTER TANK
  // ============================================================

  const RAW_TANKS = [
    'ST-01', 'ST-02', 'ST-03', 'ST-04', 'ST-05'
  ];

  const PRODUCT_TANKS = [
    'FST-01', 'FST-02',
    'TK-01', 'TK-02', 'TK-03', 'TK-04',
    'WT-01', 'WT-02', 'WT-03', 'WT-04'
  ];

  const TIRISAN_TANKS = [
    'V-01', 'V-02', 'V-03', 'V-04',
    'V-05', 'V-06', 'V-07', 'V-08',
    'TPS', 'Tangki IBC (Kempu)', 'Bak Basa'
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

  const historyEl = {
    date: document.getElementById('histDate'),
    shift: document.getElementById('histShift'),
    password: document.getElementById('histPassword'),
    status: document.getElementById('histStatus'),
    save: document.getElementById('histSave'),
    read: document.getElementById('histRead'),
    live: document.getElementById('histLive')
  };

  let isFetching = false;
  let currentProduct = null;
  let salesPage = 1;
  let isLoadingSales = false;

  let atlHistoryMode = false;
  let historyBusy = false;
  let saveAttempt = null;

  // ============================================================
  // FETCH JSON
  // ============================================================

  async function fetchApi(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
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

    if (!response.ok || !body?.success) {
      const message =
        typeof body?.error === 'string'
          ? body.error
          : body?.error?.message;

      throw new Error(
        message || `Permintaan gagal (HTTP ${response.status}).`
      );
    }

    return body;
  }

  async function fetchStock() {
    const body = await fetchApi('/api/stock');

    if (!Array.isArray(body.data?.categories)) {
      throw new Error('Format data stok dari server tidak valid.');
    }

    return {
      categories: body.data.categories,
      unconfigured: Array.isArray(body.unconfigured)
        ? body.unconfigured
        : []
    };
  }

  // ============================================================
  // LOAD DASHBOARD
  // ============================================================

  async function loadDashboard() {
    if (atlHistoryMode || historyBusy || isFetching) {
      return;
    }

    isFetching = true;
    setLoading(true);
    hideGlobalError();
    closeModal();

    try {
      renderRawMaterials();
      renderProductMaster();
      renderTirisanMaster();

      try {
        const { categories, unconfigured } = await fetchStock();

        renderStock(categories);
        updateLastUpdate();

        if (unconfigured.length) {
          showGlobalError(
            'Kategori belum terhubung ke Mekari: ' +
            unconfigured.join(', ') +
            '. Periksa product ID pada environment server.'
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
          err.message || 'Gagal mengambil data dari Mekari Jurnal.'
        );
      }

      await loadMovements();
    } finally {
      isFetching = false;
      setLoading(false);
    }
  }

  // ============================================================
  // LOG TRANSAKSI
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
  // SALES: 10 INVOICE PER HALAMAN
  // Filter ATL-Pro / ATL-Diesel dilakukan oleh server.
  // Jumlah baris produk bisa berbeda dari jumlah invoice.
  // ============================================================

  async function loadLogKeluar(page = salesPage) {
    const container = el.logProduk;

    if (
      !container ||
      isLoadingSales ||
      atlHistoryMode ||
      historyBusy
    ) {
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

      renderLogKeluar(container, body.data);
      renderSalesPagination(container, body.meta || {}, page);
    } catch (err) {
      console.error('[Log Keluar]', err);

      container.innerHTML = `
        <div class="empty-state">
          ${escapeHtml(
            err.message || 'Log produk keluar belum bisa dimuat.'
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
      const sub = [
        formatTransactionDate(row.date),
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
              ${escapeHtml(row.productName || '-')} · KELUAR
            </div>
            <div class="log-sub">${sub}</div>
          </div>

          <div class="log-qty out">
            -${escapeHtml(
              formatQtyUnit(row.quantity, row.unit || 'Liter')
            )}
          </div>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // LOG BAHAN
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
            err.message || 'Transaksi belum bisa dimuat.'
          )}
        </div>
      `;
    }
  }

  function renderMovements(container, rows, emptyMessage) {
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
        qtyNum > 0 ? 'in' : qtyNum < 0 ? 'out' : 'neutral';

      const sub = [
        formatTransactionDate(row.date),
        row.warehouse && row.warehouse !== '-'
          ? row.warehouse
          : '',
        row.note || ''
      ]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');

      return `
        <div class="log-entry">
          <div class="log-main">
            <div class="log-title">
              ${escapeHtml(row.productName || '-')}
              ${row.type ? ' · ' + escapeHtml(row.type) : ''}
            </div>
            <div class="log-sub">${sub}</div>
          </div>

          <div class="log-qty ${direction}">
            ${escapeHtml(
              formatQtyUnit(qtyNum, row.unit || 'Liter', true)
            )}
          </div>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // MASTER CARD
  // ============================================================

  function defaultTankName(type) {
    if (type === 'raw') {
      return 'Bahan Baku';
    }

    if (type === 'tirisan') {
      return 'Tirisan Produk';
    }

    return 'Produk';
  }

  function createEmptyTank(tank, type) {
    return {
      type,
      label: tank,
      code: tank,
      name: defaultTankName(type),
      qty: 0,
      availableQty: 0,
      unit: 'Liter',
      productId: null,
      sku: null,
      warehouseId: null,
      status: 'grey'
    };
  }

  function renderMaster(container, tanks, type) {
    if (!container) {
      return;
    }

    container.innerHTML = '';

    tanks.forEach((tank) => {
      container.appendChild(
        buildCard(createEmptyTank(tank, type))
      );
    });
  }

  function renderRawMaterials() {
    renderMaster(el.rawGrid, RAW_TANKS, 'raw');
  }

  function renderProductMaster() {
    renderMaster(el.productGrid, PRODUCT_TANKS, 'product');
  }

  function renderTirisanMaster() {
    renderMaster(el.tirisanGrid, TIRISAN_TANKS, 'tirisan');
  }

  // ============================================================
  // RENDER STOCK
  // Mempertahankan aturan lama:
  // satu kategori ditampilkan untuk setiap tangki.
  // Jika beberapa kategori berisi, pilih qty absolut terbesar.
  // ============================================================

  function classifyTankCode(code) {
    const trimmed = String(code).trim();
    const key = normalizeKey(code);

    if (
      RAW_TANKS.some((tank) => normalizeKey(tank) === key) ||
      /^ST[-_]?\d/i.test(trimmed)
    ) {
      return 'raw';
    }

    if (
      TIRISAN_TANKS.some((tank) => normalizeKey(tank) === key) ||
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

  function renderStock(categories) {
    if (!Array.isArray(categories)) {
      throw new Error('Format kategori stok tidak valid.');
    }

    const map = Object.create(null);
    const order = [];
    const candidates = Object.create(null);

    RAW_TANKS
      .concat(PRODUCT_TANKS)
      .concat(TIRISAN_TANKS)
      .forEach((tank) => {
        const key = normalizeKey(tank);

        map[key] = createEmptyTank(
          tank,
          classifyTankCode(tank)
        );

        order.push(key);
      });

    categories.forEach((category) => {
      if (!category) {
        return;
      }

      const warehouses = Array.isArray(category.warehouses)
        ? category.warehouses
        : [];

      warehouses.forEach((warehouse) => {
        if (!warehouse) {
          return;
        }

        const rawCode = String(
          warehouse.code || warehouse.name || ''
        ).trim();

        if (!rawCode) {
          console.warn(
            '[WAREHOUSE TANPA KODE]',
            category.label,
            warehouse
          );
          return;
        }

        const key = normalizeKey(rawCode);
        const qty = toNumber(warehouse.quantity) ?? 0;
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

        if (!map[key]) {
          map[key] = createEmptyTank(
            rawCode,
            classifyTankCode(rawCode)
          );

          order.push(key);
        }
      });
    });

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
          return Math.abs(b.qty) > Math.abs(a.qty) ? b : a;
        });

        console.warn(
          '[KONFLIK TANGKI]',
          winner.code,
          'ada isi di lebih dari satu kategori:',
          filled.map((candidate) => {
            return (
              candidate.category.label + '=' + candidate.qty
            );
          }).join(', ')
        );
      } else {
        winner = list[0];
      }

      map[key] = {
        type: classifyTankCode(winner.code),
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

      const container =
        item.type === 'raw'
          ? el.rawGrid
          : item.type === 'tirisan'
            ? el.tirisanGrid
            : el.productGrid;

      if (container) {
        container.appendChild(buildCard(item));
      }
    });

    renderSummaryTotals(zoneTotals);
  }

  // ============================================================
  // TOTAL
  // ============================================================

  function renderSummaryTotals(zoneTotals) {
    setSummaryValue(el.summaryProduk, zoneTotals.product);
    setSummaryValue(el.summaryBahanBaku, zoneTotals.raw);
    setSummaryValue(el.summaryTirisan, zoneTotals.tirisan);
  }

  function setSummaryValue(node, total) {
    if (!node) {
      return;
    }

    node.textContent =
      total === undefined || total === null
        ? '-'
        : formatQtyUnit(total, 'Liter');
  }

  // ============================================================
  // CARD
  // ============================================================

  function buildCard(item) {
    const card = document.createElement('div');

    card.className = 'tank-card';
    card.dataset.id = item.label || item.code || '';

    const qty = toNumber(item.qty) ?? 0;
    const available = toNumber(item.availableQty) ?? qty;
    const status = item.status || getStatus(qty);

    card.classList.add(`tank-status-${status}`);

    card.innerHTML = `
      <span class="status-dot status-${escapeHtml(status)}"></span>

      <div class="code">
        ${escapeHtml(item.label || item.code || '-')}
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
        <strong>${escapeHtml(formatNumber(available))}</strong>
      </div>
    `;

    card.addEventListener('click', () => {
      openDetailModal(item);
    });

    return card;
  }

  // ============================================================
  // DETAIL MODAL
  // ============================================================

  function openDetailModal(item) {
    if (!el.modal) {
      return;
    }

    currentProduct = item;

    if (el.modalTitle) {
      el.modalTitle.textContent =
        item.label || item.name || 'Detail';
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
      ['Sumber', atlHistoryMode ? 'Riwayat tersimpan' : 'Stok terkini'],
      ['Produk', item.name || '-'],
      ['Kode Tank', item.label || '-'],
      ['SKU', item.sku || '-'],
      ['Warehouse ID', item.warehouseId ?? '-'],
      [
        'Qty Sistem',
        formatQtyUnit(item.qty ?? 0, item.unit || 'Liter')
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
          <span class="label">${escapeHtml(label)}</span>
          <span class="value">${escapeHtml(String(value))}</span>
        </div>
      `;
    }).join('');
  }

  function closeModal() {
    hide(el.modal);
    currentProduct = null;
  }

  el.modalClose?.addEventListener('click', closeModal);

  el.modal?.addEventListener('click', (event) => {
    if (event.target === el.modal) {
      closeModal();
    }
  });

  // ============================================================
  // OPNAME: PERHITUNGAN SELISIH SAJA
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

    const sistem = toNumber(currentProduct.qty) ?? 0;

    el.opnameSelisih.textContent = formatQtyUnit(
      fisik - sistem,
      currentProduct.unit || 'Liter',
      true
    );
  });

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
  // RIWAYAT STOK GOOGLE SHEETS
  // ============================================================

  function historyMessage(message) {
    if (historyEl.status) {
      historyEl.status.textContent = message;
    }
  }

  function setHistoryBusy(busy) {
    historyBusy = busy;

    [
      historyEl.save,
      historyEl.read,
      historyEl.live,
      historyEl.date,
      historyEl.shift,
      historyEl.password
    ].forEach((node) => {
      if (node) {
        node.disabled = busy;
      }
    });

    if (el.refreshBtn) {
      el.refreshBtn.disabled = busy || isFetching;
    }
  }

  function todayJakarta() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const values = {};

    parts.forEach((part) => {
      values[part.type] = part.value;
    });

    return `${values.year}-${values.month}-${values.day}`;
  }

  function createSnapshotId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    return Array.from(bytes, (value) => {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  async function historyAction(save) {
    if (
      !historyEl.date ||
      !historyEl.shift ||
      !historyEl.password ||
      !historyEl.status
    ) {
      showGlobalError(
        'Panel riwayat belum lengkap. Gunakan index.html versi riwayat.'
      );
      return;
    }

    if (historyBusy || isFetching || isLoadingSales) {
      historyMessage('Tunggu pemuatan data selesai, lalu coba lagi.');
      return;
    }

    const date = historyEl.date.value;
    const shift = historyEl.shift.value;
    const password = historyEl.password.value;

    if (!date) {
      historyMessage('Pilih tanggal terlebih dahulu.');
      return;
    }

    if (!['1', '2', '3'].includes(shift)) {
      historyMessage('Pilih shift 1, 2, atau 3.');
      return;
    }

    if (!password) {
      historyMessage(
        'Masukkan password admin sesuai STOCK_ADMIN_TOKEN di Render.'
      );
      return;
    }

    if (
      save &&
      !window.confirm(
        'Simpan stok Jurnal SAAT INI untuk tanggal operasional ' +
        date +
        ', shift ' +
        shift +
        '?\n\nIni tidak mengambil stok masa lalu.'
      )
    ) {
      return;
    }

    const previousMode = atlHistoryMode;

    setHistoryBusy(true);
    atlHistoryMode = true;
    historyMessage(
      save
        ? 'Mengambil stok Jurnal dan menyimpan ke Google Sheets...'
        : 'Membaca riwayat dari Google Sheets...'
    );

    try {
      const headers = {
        'X-Stock-Admin-Token': password
      };

      let body;

      if (save) {
        const key = date + ':' + shift;

        if (!saveAttempt || saveAttempt.key !== key) {
          saveAttempt = {
            key,
            id: createSnapshotId()
          };
        }

        body = await fetchApi('/api/stock-snapshot', {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            date,
            shift,
            id: saveAttempt.id
          })
        });

        atlHistoryMode = previousMode;

        historyMessage(
          'Snapshot tersimpan untuk ' +
          date +
          ' · Shift ' +
          shift +
          '. Klik Tampilkan Riwayat untuk melihatnya.'
        );
      } else {
        const query = new URLSearchParams({
          date,
          shift
        });

        body = await fetchApi(
          '/api/stock-history?' + query.toString(),
          { headers }
        );

        if (!Array.isArray(body.data?.categories)) {
          throw new Error('Format riwayat stok dari server tidak valid.');
        }

        closeModal();
        renderStock(body.data.categories);
        hideGlobalError();

        const label =
          'RIWAYAT: ' +
          date +
          ' · Shift ' +
          shift +
          ' · Diambil ' +
          formatDateTime(new Date(body.savedAt));

        historyMessage(label);

        if (el.lastUpdate) {
          el.lastUpdate.textContent = label;
        }

        if (el.logBahan) {
          el.logBahan.textContent =
            'Log transaksi tidak disertakan dalam snapshot stok.';
        }

        if (el.logProduk) {
          el.logProduk.textContent =
            'Log sales tidak disertakan dalam snapshot stok.';
        }
      }
    } catch (err) {
      console.error('[Riwayat Stok]', err);
      atlHistoryMode = previousMode;

      historyMessage(
        (err.message || 'Permintaan riwayat gagal.') +
        (save
          ? ' Jika status simpan belum jelas, cek Tampilkan Riwayat sebelum mengulang.'
          : ' Tampilan stok sebelumnya tetap ditampilkan.')
      );
    } finally {
      setHistoryBusy(false);
    }
  }

  function returnToLive() {
    if (historyBusy || isFetching || isLoadingSales) {
      historyMessage('Tunggu pemuatan selesai.');
      return;
    }

    atlHistoryMode = false;
    historyMessage('Mode: stok terkini dari Jurnal.');
    loadDashboard();
  }

  if (historyEl.date && !historyEl.date.value) {
    historyEl.date.value = todayJakarta();
  }

  historyEl.save?.addEventListener('click', (event) => {
    event.preventDefault();
    historyAction(true);
  });

  historyEl.read?.addEventListener('click', (event) => {
    event.preventDefault();
    historyAction(false);
  });

  historyEl.live?.addEventListener('click', (event) => {
    event.preventDefault();
    returnToLive();
  });

  // Refresh pada mode riwayat membaca ulang snapshot yang dipilih.
  el.refreshBtn?.addEventListener('click', () => {
    if (atlHistoryMode) {
      historyAction(false);
    } else {
      loadDashboard();
    }
  });

  // ============================================================
  // UI
  // ============================================================

  function setLoading(isLoading) {
    el.loadingBar?.classList.toggle('hidden', !isLoading);
    el.refreshBtn?.classList.toggle('spinning', isLoading);

    if (el.refreshBtn) {
      el.refreshBtn.disabled = isLoading || historyBusy;
    }
  }

  function updateLastUpdate() {
    if (el.lastUpdate) {
      el.lastUpdate.textContent =
        'Stok terkini · ' + formatDateTime(new Date());
    }
  }

  function formatDateTime(date) {
    if (
      !(date instanceof Date) ||
      Number.isNaN(date.getTime())
    ) {
      return '-';
    }

    return date.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' WIB';
  }

  function formatTransactionDate(value) {
    if (!value) {
      return '-';
    }

    const text = String(value).trim();

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

    return date.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
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

    return Number.isFinite(number) ? number : null;
  }

  function formatNumber(value) {
    const number = toNumber(value) ?? 0;

    return number.toLocaleString('id-ID', {
      maximumFractionDigits: 2
    });
  }

  function formatQtyUnit(value, unit, signed) {
    const number = toNumber(value) ?? 0;
    const sign = signed && number > 0 ? '+' : '';

    return (
      sign +
      formatNumber(number) +
      (unit ? ` ${unit}` : '')
    );
  }

  function getStatus(qty) {
    return (toNumber(qty) ?? 0) <= 0 ? 'grey' : 'green';
  }

  function normalizeKey(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  function normalizeWarehouseCode(value) {
    const key = normalizeKey(value);
    const match = key.match(/^TK0*(\d+)$/);

    return match ? `TK${Number(match[1])}` : key;
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) {
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
  // Interval ini hanya refresh tampilan, bukan autosave.
  // ============================================================

  loadDashboard();

  setInterval(() => {
    if (!atlHistoryMode && !historyBusy) {
      loadDashboard();
    }
  }, REFRESH_INTERVAL_MS);
})();

// ATL AI panel: no API key or admin password is persisted in browser storage.
(() => {
 const toggle=document.getElementById('atlAiToggle'), panel=document.getElementById('atlAiPanel');
 if(!toggle || !panel) return;
 const form=document.getElementById('atlAiForm'), input=document.getElementById('atlAiInput'), log=document.getElementById('atlAiLog'), status=document.getElementById('atlAiStatus'), send=document.getElementById('atlAiSend');
 let history=[],busy=false;
 function bubble(role,text){const div=document.createElement('div');div.className='atl-ai-message '+role;div.textContent=text;log.appendChild(div);log.scrollTop=log.scrollHeight;}
 function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}
 toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden) input.focus();});
 document.getElementById('atlAiClose').addEventListener('click',close);
 panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 document.getElementById('atlAiClear').addEventListener('click',()=>{if(busy)return;history=[];log.replaceChildren();document.getElementById('atlAiPassword').value='';status.textContent='Percakapan dihapus.';});
 form.addEventListener('submit',async e=>{
  e.preventDefault(); if(busy)return;
  const text=input.value.trim(),password=document.getElementById('atlAiPassword').value;
  if(!text)return;
  if(!password){status.textContent='Isi password admin stok terlebih dahulu.';document.getElementById('atlAiPassword').focus();return;}
  busy=true;send.disabled=true;input.disabled=true;status.textContent='Membaca pertanyaan dan mengambil data...';bubble('user',text);input.value='';
  const messages=[...history.slice(-8),{role:'user',content:text}];
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),180000);
  try{
   const r=await fetch('/api/ai-chat',{method:'POST',headers:{'Content-Type':'application/json','X-Stock-Admin-Token':password},body:JSON.stringify({messages}),signal:controller.signal});
   let body;try{body=await r.json();}catch{throw new Error('Server belum merespons dengan benar. Periksa deploy Render.');}
   if(!r.ok || !body.success)throw new Error(body.error || 'Permintaan AI gagal.');
   bubble('assistant',body.reply);history=[...messages,{role:'assistant',content:body.reply.slice(0,2000)}];status.textContent='Jawaban AI berdasarkan data yang diambil. Periksa sumber dan waktunya.';
  }catch(err){status.textContent=err.name==='AbortError'?'Permintaan terlalu lama. Coba lagi.':err.message;input.value=text;}
  finally{clearTimeout(timer);busy=false;send.disabled=false;input.disabled=false;input.focus();}
 });
})();
