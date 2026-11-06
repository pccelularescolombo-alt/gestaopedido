// ===== FIREBASE INIT =====
const firebaseConfig = {
    apiKey: "AIzaSyC0-FQuZKnf87PL0vmauNgJ3RM-ejIHtg8",
    authDomain: "pedido-bbe60.firebaseapp.com",
    projectId: "pedido-bbe60",
    storageBucket: "pedido-bbe60.firebasestorage.app",
    messagingSenderId: "664032826197",
    appId: "1:664032826197:web:f5f81062080a6321f215dc"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ===== DATA CACHE =====
let cacheProducts = [];
let cacheOrders = [];
let cacheFridayProducts = [];
let cacheConfig = { storeName: 'Loja' };

// Colecoes na raiz do banco (uso unico da loja, sem usuarios)
const colProducts = db.collection('products');
const colOrders = db.collection('orders');
const colFriday = db.collection('fridayClientProducts');
const colConfig = db.collection('config');

async function loadAllData() {
    try {
        const [pSnap, oSnap, fSnap, cSnap] = await Promise.all([
            colProducts.get(),
            colOrders.orderBy('timestamp', 'asc').get(),
            colFriday.get(),
            colConfig.get()
        ]);
        cacheProducts = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        cacheOrders = oSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        cacheFridayProducts = fSnap.docs.map(d => {
            const data = { id: d.id, ...d.data() };
            if (!data.type) data.type = 'friday';
            return data;
        });
        cSnap.docs.forEach(d => { cacheConfig[d.id] = d.data().value; });
    } catch (err) {
        console.error('Erro Firebase:', err);
        alert('Erro ao conectar com o banco de dados. Verifique as regras do Firestore e a internet.');
    }
}

function getConfig(key) { return cacheConfig[key] || ''; }
async function setConfig(key, value) {
    cacheConfig[key] = value;
    await colConfig.doc(key).set({ value });
}

async function fsAddProduct(name, estoque, nicolaType) {
    const productData = { name, estoque };
    if (nicolaType) productData.nicolaType = nicolaType;
    const ref = await colProducts.add(productData);
    cacheProducts.push({ id: ref.id, ...productData });
    return ref.id;
}
async function fsDeleteProduct(docId) {
    await colProducts.doc(docId).delete();
    cacheProducts = cacheProducts.filter(p => p.id !== docId);
}
async function fsUpdateProduct(docId, name, estoque) {
    await colProducts.doc(docId).update({ name, estoque });
    const idx = cacheProducts.findIndex(p => p.id === docId);
    if (idx !== -1) { cacheProducts[idx].name = name; cacheProducts[idx].estoque = estoque; }
}
async function fsAddOrder(orderData) {
    const ref = await colOrders.add({ ...orderData, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    cacheOrders.push({ id: ref.id, ...orderData });
    return ref.id;
}
async function fsUpdateOrder(docId, data) {
    await colOrders.doc(docId).update(data);
    const idx = cacheOrders.findIndex(o => o.id === docId);
    if (idx !== -1) Object.assign(cacheOrders[idx], data);
}
async function fsDeleteOrder(docId) {
    await colOrders.doc(docId).delete();
    cacheOrders = cacheOrders.filter(o => o.id !== docId);
}
async function fsAddFridayProduct(name, quantity, clientName, clientPhone, type) {
    const data = { name, quantity: quantity || 1, type: type || 'friday' };
    if (clientName) data.clientName = clientName;
    if (clientPhone) data.clientPhone = clientPhone;
    const ref = await colFriday.add(data);
    cacheFridayProducts.push({ id: ref.id, ...data });
    return ref.id;
}
async function fsDeleteFridayProduct(docId) {
    await colFriday.doc(docId).delete();
    cacheFridayProducts = cacheFridayProducts.filter(p => p.id !== docId);
}
async function fsClearFridayProducts() {
    const batch = db.batch();
    cacheFridayProducts.forEach(p => batch.delete(colFriday.doc(p.id)));
    await batch.commit();
    cacheFridayProducts = [];
}

// ===== APP STATE =====
let currentOrderItems = [];
let selectedProduct = null;
let lastSavedOrderId = null;
let selectedCheckOrderId = null;
let selectedAdminOrderId = null;
let editingOrderId = null;
let editingItems = [];
let showingProductsWithoutOrders = false;
let productsCurrentPage = 1;
let statsCurrentPage = 1;
const productsPerPage = 20;
const statsPerPage = 20;

// ===== INIT =====
(async function init() {
    await loadAllData();
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    loadStoreName();
    restoreOrderDraft();
    populateDateSelects();
})();

// ===== UI HELPERS =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}
function showTabMobile(tabName) { closeSidebar(); showTab(tabName); updateSidebarActive(tabName); }
function updateSidebarActive(tabName) {
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    const item = document.getElementById('side-' + tabName);
    if (item) item.classList.add('active');
}
function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    document.getElementById('content-' + tabName).classList.add('active');
    updateSidebarActive(tabName);
    if (tabName === 'orderManagement') loadAdminOrders();
    if (tabName === 'products') loadProducts();
    if (tabName === 'checkOrder') loadOrdersToCheck();
    if (tabName === 'statistics') updateStats();
    if (tabName === 'reports') populateDateSelects();
    if (tabName === 'fridayOrder') loadFridayOrder();
    if (tabName === 'settings') loadStoreName();
}
function loadStoreName() {
    const name = getConfig('storeName') || 'Loja';
    document.getElementById('storeNameDisplay').textContent = name;
    const inp = document.getElementById('storeNameInput');
    if (inp) inp.value = name;
}
async function saveStoreName() {
    const name = document.getElementById('storeNameInput').value.trim();
    if (name) { await setConfig('storeName', name); loadStoreName(); alert('Nome da loja salvo!'); }
}

// ===== AUTOSAVE (rascunho local) =====
function autoSaveOrder() {
    const draft = { items: currentOrderItems, estoque: document.getElementById('orderEstoque').value, timestamp: new Date().toISOString() };
    localStorage.setItem('currentOrderDraft', JSON.stringify(draft));
    const ind = document.getElementById('autosaveIndicator');
    ind.classList.add('show');
    setTimeout(() => ind.classList.remove('show'), 2000);
}
function restoreOrderDraft() {
    const draft = JSON.parse(localStorage.getItem('currentOrderDraft') || '{"items":[],"estoque":""}');
    if (draft.items && draft.items.length > 0) {
        currentOrderItems = draft.items;
        document.getElementById('orderEstoque').value = draft.estoque || '';
        filterProductsByEstoque();
        displayCurrentOrder();
    }
}
function clearAutoSave() { localStorage.setItem('currentOrderDraft', JSON.stringify({ items: [], estoque: '' })); }

// ===== PRODUCTS =====
function clearProductsSearchFilter() {
    document.getElementById('productsSearchFilter').value = '';
    productsCurrentPage = 1;
    loadProducts(1);
}
function loadProducts(page) {
    if (page) productsCurrentPage = page;
    const sel = document.getElementById('productsEstoqueFilter').value;
    const searchEl = document.getElementById('productsSearchFilter');
    const searchTerm = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const list = document.getElementById('productsList');
    const pag = document.getElementById('productsPagination');
    if (!sel) { list.innerHTML = '<div class="empty-state">Selecione um estoque para visualizar os produtos</div>'; pag.innerHTML = ''; return; }
    let filtered = cacheProducts.filter(p => p.estoque === sel);
    if (searchTerm) filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm));
    filtered.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    if (filtered.length === 0) { list.innerHTML = '<div class="empty-state">Nenhum produto encontrado' + (searchTerm ? ' para "' + searchTerm + '"' : '') + '</div>'; pag.innerHTML = ''; return; }
    const totalPages = Math.ceil(filtered.length / productsPerPage);
    if (productsCurrentPage > totalPages) productsCurrentPage = totalPages;
    const start = (productsCurrentPage - 1) * productsPerPage;
    const pageItems = filtered.slice(start, start + productsPerPage);
    let html = '';
    pageItems.forEach(p => {
        let typeLabel = '';
        if (p.estoque === 'Estoque Nicola' && p.nicolaType) {
            const typeText = p.nicolaType === 'pel' ? 'Película' : 'Produto';
            const typeColor = p.nicolaType === 'pel' ? '#7c3aed' : '#059669';
            typeLabel = '<span style="color:' + typeColor + ';font-size:11px;padding:2px 8px;background:' + (p.nicolaType === 'pel' ? '#ede9fe' : '#d1fae5') + ';border-radius:6px;margin-left:8px;font-weight:600;">' + typeText + '</span>';
        }
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#f9fafb;border-radius:8px;margin-bottom:6px;border-left:3px solid #2563eb;">' +
            '<div><span style="color:#374151;font-weight:600;">' + p.name + '</span>' +
            '<span style="color:#2563eb;font-size:11px;padding:2px 8px;background:#eff6ff;border-radius:6px;margin-left:10px;">' + p.estoque + '</span>' +
            typeLabel + '</div>' +
            '<div style="display:flex;gap:8px;">' +
            '<button class="btn-edit btn-small" onclick="editProduct(\'' + p.id + '\')">Editar</button>' +
            '<button class="btn-danger btn-small" onclick="removeProduct(\'' + p.id + '\')">Remover</button></div></div>';
    });
    list.innerHTML = html;
    if (totalPages <= 1) { pag.innerHTML = '<span style="color:#6b7280;font-size:13px;">' + filtered.length + ' produto(s)</span>'; return; }
    let ph = '<button class="btn-small" style="padding:8px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;color:#2563eb;cursor:pointer;" onclick="loadProducts(' + (productsCurrentPage-1) + ')"' + (productsCurrentPage===1?' disabled style="opacity:0.3;cursor:default;"':'') + '>Anterior</button>';
    ph += '<span style="color:#6b7280;font-size:14px;">Pagina ' + productsCurrentPage + ' de ' + totalPages + ' (' + filtered.length + ' produtos)</span>';
    ph += '<button class="btn-small" style="padding:8px 14px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;color:#2563eb;cursor:pointer;" onclick="loadProducts(' + (productsCurrentPage+1) + ')"' + (productsCurrentPage===totalPages?' disabled style="opacity:0.3;cursor:default;"':'') + '>Proxima</button>';
    pag.innerHTML = ph;
}
function toggleNicolaType() {
    const estoque = document.getElementById('newProductEstoque').value;
    const typeSelect = document.getElementById('newProductNicolaType');
    if (estoque === 'Estoque Nicola') { typeSelect.classList.remove('hidden'); typeSelect.value = ''; }
    else { typeSelect.classList.add('hidden'); typeSelect.value = ''; }
}
async function addProduct() {
    const name = document.getElementById('newProductName').value.trim();
    const estoque = document.getElementById('newProductEstoque').value;
    const nicolaType = document.getElementById('newProductNicolaType').value;
    if (!name) { alert('Digite o nome do produto!'); return; }
    if (!estoque) { alert('Selecione o estoque!'); return; }
    if (estoque === 'Estoque Nicola' && !nicolaType) { alert('Selecione o tipo (Película ou Produto)!'); return; }
    if (cacheProducts.some(p => p.name === name && p.estoque === estoque)) { alert('Produto ja existe neste estoque!'); return; }
    await fsAddProduct(name, estoque, nicolaType || null);
    document.getElementById('newProductName').value = '';
    document.getElementById('newProductEstoque').value = '';
    document.getElementById('newProductNicolaType').value = '';
    document.getElementById('newProductNicolaType').classList.add('hidden');
    loadProducts(); updateStats(); alert('Produto adicionado!');
}
async function removeProduct(docId) {
    if (confirm('Deseja remover este produto?')) { await fsDeleteProduct(docId); loadProducts(); updateStats(); }
}

let editingProductId = null;

function editProduct(docId) {
    const product = cacheProducts.find(p => p.id === docId);
    if (!product) return;
    editingProductId = docId;
    document.getElementById('editProductName').value = product.name;
    document.getElementById('editProductEstoque').value = product.estoque;
    document.getElementById('editProductModal').classList.remove('hidden');
}
async function saveEditProduct() {
    const name = document.getElementById('editProductName').value.trim();
    const estoque = document.getElementById('editProductEstoque').value;
    if (!name) { alert('Digite o nome do produto!'); return; }
    if (!estoque) { alert('Selecione o estoque!'); return; }
    const duplicate = cacheProducts.find(p => p.name === name && p.estoque === estoque && p.id !== editingProductId);
    if (duplicate) { alert('Já existe um produto com este nome neste estoque!'); return; }
    await fsUpdateProduct(editingProductId, name, estoque);
    closeEditProductModal();
    loadProducts();
    updateStats();
    alert('Produto atualizado com sucesso!');
}
function closeEditProductModal() {
    document.getElementById('editProductModal').classList.add('hidden');
    editingProductId = null;
}

function exportProducts() {
    if (cacheProducts.length === 0) { alert('Nenhum produto para exportar!'); return; }
    const data = { products: cacheProducts.map(p => { const o = { name: p.name, estoque: p.estoque }; if (p.nicolaType) o.nicolaType = p.nicolaType; return o; }), exportDate: new Date().toLocaleString('pt-BR'), type: 'products' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'produtos_' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
async function importProducts(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            let list = data.products || (Array.isArray(data) ? data : []);
            if (list.length === 0) { alert('Formato invalido!'); return; }
            if (!confirm('Importar ' + list.length + ' produto(s)?\nOs produtos serao ADICIONADOS.')) return;
            let added = 0;
            for (const p of list) {
                const name = p.name || p; const estoque = p.estoque || 'Estoque Produtos';
                if (name && !cacheProducts.some(c => c.name === name && c.estoque === estoque)) {
                    await fsAddProduct(name, estoque, p.nicolaType || null); added++;
                }
            }
            loadProducts(1);
            document.getElementById('importProductsStatus').innerHTML = '<span style="color:#059669;font-weight:600;">' + added + ' produto(s) importado(s)!</span>';
            setTimeout(() => { document.getElementById('importProductsStatus').innerHTML = ''; }, 4000);
        } catch (err) { alert('Erro ao importar: arquivo invalido.'); }
    };
    reader.readAsText(file); event.target.value = '';
}

// ===== ORDER CREATION =====
function filterProductsByEstoque() {
    document.getElementById('productSearch').value = '';
    selectedProduct = null;
    document.getElementById('searchDropdown').classList.add('hidden');

    const estoque = document.getElementById('orderEstoque').value;
    const qtyField = document.getElementById('itemQuantity');
    const qtyMField = document.getElementById('itemQuantityM');
    const qtyFField = document.getElementById('itemQuantityF');
    const qtyCXField = document.getElementById('itemQuantityCX');
    const nicolaTypeSelect = document.getElementById('orderNicolaType');

    qtyField.classList.add('hidden');
    qtyMField.classList.add('hidden');
    qtyFField.classList.add('hidden');
    qtyCXField.classList.add('hidden');
    nicolaTypeSelect.classList.add('hidden');
    nicolaTypeSelect.value = '';

    if (estoque === 'Estoque Capa') {
        qtyMField.classList.remove('hidden');
        qtyFField.classList.remove('hidden');
    } else if (estoque === 'Estoque Nicola') {
        nicolaTypeSelect.classList.remove('hidden');
    } else {
        qtyField.classList.remove('hidden');
    }

    qtyField.value = '';
    qtyMField.value = '';
    qtyFField.value = '';
    qtyCXField.value = '';
}
function onNicolaTypeChange() {
    const nicolaType = document.getElementById('orderNicolaType').value;
    const qtyField = document.getElementById('itemQuantity');
    const qtyCXField = document.getElementById('itemQuantityCX');

    qtyField.classList.add('hidden');
    qtyCXField.classList.add('hidden');
    qtyField.value = '';
    qtyCXField.value = '';
    document.getElementById('productSearch').value = '';
    selectedProduct = null;
    document.getElementById('searchDropdown').classList.add('hidden');

    if (nicolaType === 'pel') {
        qtyCXField.classList.remove('hidden');
        qtyCXField.placeholder = 'CX';
    } else if (nicolaType === 'prod') {
        qtyField.classList.remove('hidden');
        qtyField.placeholder = 'Quantidade';
    }
}
function searchProducts() {
    const term = document.getElementById('productSearch').value.toLowerCase();
    const sel = document.getElementById('orderEstoque').value;
    const dd = document.getElementById('searchDropdown');
    if (!sel) { dd.innerHTML = '<div class="no-results">Selecione um estoque primeiro</div>'; dd.classList.remove('hidden'); return; }
    let filtered = cacheProducts.filter(p => p.estoque === sel && p.name.toLowerCase().includes(term));
    if (sel === 'Estoque Nicola') {
        const nicolaType = document.getElementById('orderNicolaType').value;
        if (nicolaType) {
            filtered = filtered.filter(p => p.nicolaType === nicolaType);
        } else {
            dd.innerHTML = '<div class="no-results">Selecione o tipo (Película ou Produto) primeiro</div>'; dd.classList.remove('hidden'); return;
        }
    }
    filtered.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    if (filtered.length === 0) { dd.innerHTML = '<div class="no-results">Nenhum produto encontrado</div>'; dd.classList.remove('hidden'); return; }
    dd.innerHTML = '';
    filtered.forEach(p => {
        const item = document.createElement('div'); item.className = 'search-dropdown-item';
        item.textContent = p.name; item.onclick = function() { selectProduct(p); };
        dd.appendChild(item);
    });
    dd.classList.remove('hidden');
}
function selectProduct(product) {
    selectedProduct = product;
    document.getElementById('productSearch').value = product.name;
    document.getElementById('searchDropdown').classList.add('hidden');
}
document.addEventListener('click', function(e) {
    if (!e.target.closest('.search-container')) {
        document.getElementById('searchDropdown').classList.add('hidden');
        const checkExtraDropdown = document.getElementById('checkExtraSearchDropdown');
        if (checkExtraDropdown) checkExtraDropdown.classList.add('hidden');
    }
});
function addItem() {
    const estoque = document.getElementById('orderEstoque').value;
    const others = document.getElementById('itemOthers').value;

    if (!selectedProduct) { alert('Selecione um produto!'); return; }
    if (!estoque) { alert('Selecione o estoque!'); return; }

    let itemData = { product: selectedProduct.name, estoque: selectedProduct.estoque, others: others };

    if (estoque === 'Estoque Capa') {
        const qtyM = parseInt(document.getElementById('itemQuantityM').value) || 0;
        const qtyF = parseInt(document.getElementById('itemQuantityF').value) || 0;
        if (qtyM === 0 && qtyF === 0) { alert('Informe pelo menos uma quantidade (Masculina ou Feminina)!'); return; }
        itemData.quantityM = qtyM;
        itemData.quantityF = qtyF;
        itemData.quantity = qtyM + qtyF;
        document.getElementById('itemQuantityM').value = '';
        document.getElementById('itemQuantityF').value = '';
    } else if (estoque === 'Estoque Nicola') {
        const nicolaType = document.getElementById('orderNicolaType').value;
        if (!nicolaType) { alert('Selecione o tipo (Película ou Produto)!'); return; }
        itemData.nicolaType = nicolaType;
        if (nicolaType === 'pel') {
            const cx = parseInt(document.getElementById('itemQuantityCX').value);
            if (!cx || cx < 1) { alert('Informe a quantidade CX!'); return; }
            itemData.quantityCX = cx;
            itemData.quantity = cx;
            document.getElementById('itemQuantityCX').value = '';
        } else {
            const qty = parseInt(document.getElementById('itemQuantity').value);
            if (!qty || qty < 1) { alert('Informe a quantidade!'); return; }
            itemData.quantity = qty;
            document.getElementById('itemQuantity').value = '';
        }
    } else {
        const qty = parseInt(document.getElementById('itemQuantity').value);
        if (!qty || qty < 1) { alert('Informe a quantidade!'); return; }
        itemData.quantity = qty;
        document.getElementById('itemQuantity').value = '';
    }

    currentOrderItems.push(itemData);
    document.getElementById('productSearch').value = '';
    document.getElementById('itemOthers').value = '';
    selectedProduct = null;
    document.getElementById('searchDropdown').classList.add('hidden');
    document.getElementById('lastSavedOrderSection').classList.add('hidden');
    displayCurrentOrder(); autoSaveOrder();
}
function formatItemDisplay(item) {
    if (item.estoque === 'Estoque Capa' && (item.quantityM !== undefined || item.quantityF !== undefined)) {
        return item.product + ': ' + (item.quantityM || 0) + 'M ' + (item.quantityF || 0) + 'F';
    } else if (item.estoque === 'Estoque Nicola') {
        if (item.nicolaType === 'pel') return 'Película: ' + (item.quantityCX || 0) + ' CX: ' + item.product;
        return 'Produto: ' + item.quantity + ' ' + item.product;
    }
    return item.quantity + 'x ' + item.product;
}
function displayCurrentOrder() {
    const c = document.getElementById('currentOrderItems');
    if (currentOrderItems.length === 0) { c.innerHTML = '<div class="empty-state">Nenhum item adicionado</div>'; return; }
    c.innerHTML = '';
    currentOrderItems.forEach(function(item, i) {
        const div = document.createElement('div'); div.className = 'order-item';
        div.innerHTML = '<div class="order-item-info"><strong>' + formatItemDisplay(item) + '</strong>' +
            (item.others ? '<br><small style="color:#6b7280;">' + item.others + '</small>' : '') + '</div>' +
            '<button class="btn-danger" onclick="removeItem(' + i + ')">Remover</button>';
        c.appendChild(div);
    });
}
function removeItem(i) { currentOrderItems.splice(i, 1); displayCurrentOrder(); autoSaveOrder(); }
function clearCurrentOrder() {
    if (currentOrderItems.length > 0 && confirm('Deseja limpar todos os itens?')) {
        currentOrderItems = []; displayCurrentOrder(); clearAutoSave();
        document.getElementById('lastSavedOrderSection').classList.add('hidden');
    }
}
async function saveOrder() {
    if (currentOrderItems.length === 0) { alert('Adicione pelo menos um item ao pedido!'); return; }
    const estoque = document.getElementById('orderEstoque').value;
    if (!estoque) { alert('Selecione o estoque!'); return; }
    const storeName = getConfig('storeName') || 'Loja';
    const order = { storeName: storeName, estoque: estoque, date: new Date().toLocaleString('pt-BR'), items: currentOrderItems.slice(), status: 'Pendente', checkData: [] };
    const newId = await fsAddOrder(order);
    lastSavedOrderId = newId;
    currentOrderItems = [];
    document.getElementById('orderEstoque').value = '';
    filterProductsByEstoque();
    displayCurrentOrder(); clearAutoSave();
    document.getElementById('lastSavedOrderSection').classList.remove('hidden');
    alert('Pedido salvo com sucesso!');
}

// ===== COPY ORDERS =====
function copyLastSavedOrder() { if (!lastSavedOrderId) { alert('Nenhum pedido recente!'); return; } copyOrderText(lastSavedOrderId); }
function copyOrderText(orderId) {
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order) return;
    let text = 'Pedido ' + order.storeName + ' - ' + (order.estoque || 'Sem estoque') + '\nData: ' + order.date + '\n\n';

    if (order.estoque === 'Estoque Nicola') {
        const pelItems = order.items.filter(function(i) { return i.nicolaType === 'pel'; });
        const prodItems = order.items.filter(function(i) { return i.nicolaType !== 'pel'; });
        if (pelItems.length > 0) {
            text += 'Película:\n';
            pelItems.forEach(function(item) {
                text += (item.quantityCX || item.quantity || 0) + ' CX: ' + item.product + (item.others ? ' ' + item.others : '') + '\n';
            });
        }
        if (prodItems.length > 0) {
            if (pelItems.length > 0) text += '\n';
            text += 'Produto:\n';
            prodItems.forEach(function(item) {
                text += item.quantity + ' ' + item.product + (item.others ? ' ' + item.others : '') + '\n';
            });
        }
    } else {
        order.items.forEach(function(item) {
            let itemText = '';
            if (item.estoque === 'Estoque Capa' && (item.quantityM !== undefined || item.quantityF !== undefined)) {
                itemText = item.product + ': ' + (item.quantityM || 0) + 'M ' + (item.quantityF || 0) + 'F';
            } else {
                itemText = item.quantity + ' ' + item.product;
            }
            text += itemText + (item.others ? ' ' + item.others : '') + '\n';
        });
    }
    navigator.clipboard.writeText(text).then(function() { alert('Pedido copiado!'); }).catch(function() {
        const ta = document.createElement('textarea'); ta.value = text;
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); alert('Pedido copiado!'); } catch(e) { alert('Texto:\n\n' + text); }
        document.body.removeChild(ta);
    });
}
function copyOriginalOrderFromCheck() { if (!selectedCheckOrderId) return; copyOrderText(selectedCheckOrderId); }

// ===== CHECK ORDERS =====
function loadOrdersToCheck() {
    const sel = document.getElementById('checkEstoqueFilter').value;
    let filtered = sel ? cacheOrders.filter(function(o) { return o.estoque === sel; }) : cacheOrders.slice();
    const recent = filtered.slice(-10).reverse();
    const container = document.getElementById('ordersListToSelect');
    document.getElementById('checkOrderDetail').classList.add('hidden');
    document.getElementById('ordersListToSelect').parentElement.classList.remove('hidden');
    selectedCheckOrderId = null;
    if (recent.length === 0) { container.innerHTML = '<div class="empty-state">Nenhum pedido para conferir</div>'; return; }
    container.innerHTML = '';
    recent.forEach(function(order) {
        const sc = order.status === 'Pendente' ? 'status-pending' : 'status-checked';
        const et = order.estoque ? '<span style="background:#eff6ff;color:#2563eb;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">' + order.estoque + '</span>' : '';
        const ic = order.items.reduce(function(s, i) { return s + i.quantity; }, 0);
        const div = document.createElement('div'); div.className = 'admin-order-card'; div.style.cursor = 'pointer';
        div.onclick = function() { openCheckOrder(order.id); };
        div.innerHTML = '<div class="admin-order-header" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">' +
            '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
            '<span class="order-date">' + order.date + '</span>' + et + '<span class="status-badge ' + sc + '">' + order.status + '</span></div>' +
            '<span style="color:#6b7280;font-size:13px;">' + order.items.length + ' produto(s) | ' + ic + ' un.</span></div>';
        container.appendChild(div);
    });
}
function openCheckOrder(orderId) {
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order) return;
    selectedCheckOrderId = orderId;
    restoreCheckFromLocalStorage(orderId, order);
    document.getElementById('ordersListToSelect').parentElement.classList.add('hidden');
    document.getElementById('checkOrderDetail').classList.remove('hidden');
    const et = order.estoque ? ' - ' + order.estoque : '';
    document.getElementById('checkOrderTitle').innerHTML = 'Pedido ' + order.date + et;
    const isChecked = order.status === 'Conferido';
    document.getElementById('btnSaveCheck').classList.toggle('hidden', isChecked);
    document.getElementById('checkCopySection').classList.toggle('hidden', !isChecked);
    const searchInput = document.getElementById('checkSearchFilter');
    if (searchInput) searchInput.value = '';
    renderCheckOrderItems(order, isChecked);
    const extraSection = document.getElementById('checkExtraProductsSection');
    if (extraSection) extraSection.classList.toggle('hidden', isChecked);
    renderCheckExtraProducts(order);
}
function renderCheckOrderItems(order, isChecked) {
    const filterTerm = (document.getElementById('checkSearchFilter').value || '').toLowerCase();
    const container = document.getElementById('checkOrderItems');
    container.innerHTML = '';
    order.items.forEach(function(item, itemIndex) {
        if (filterTerm && !item.product.toLowerCase().includes(filterTerm)) return;
        const cd = order.checkData && order.checkData[itemIndex];
        const cs = cd ? cd.status : '';
        const rq = cd && cd.receivedQuantity !== undefined ? cd.receivedQuantity : '';
        const div = document.createElement('div'); div.className = 'order-item';
        div.setAttribute('data-item-index', itemIndex);
        div.style.flexDirection = 'column'; div.style.alignItems = 'stretch';

        let innerHtml = '<div><strong>' + formatItemDisplay(item) + '</strong>' +
            (item.others ? '<br><small style="color:#6b7280;">' + item.others + '</small>' : '') + '</div>';
        if (isChecked) {
            const color = cs === 'Correto' ? '#059669' : cs === 'Faltando' ? '#d97706' : '#dc2626';
            const label = cs === 'Correto' ? 'Correto' : cs === 'Faltando' ? 'Faltando (Recebido: ' + (rq || 0) + ')' : 'Nao veio';
            innerHtml += '<div style="margin-top:8px;padding:8px;background:#f9fafb;border-radius:6px;"><span style="color:' + color + ';font-weight:600;">' + label + '</span></div>';
        } else {
            const clsCorrecto = cs === 'Correto' ? ' selected-correcto' : '';
            const clsFaltando = cs === 'Faltando' ? ' selected-faltando' : '';
            const clsNaoveio = cs === 'Nao veio' ? ' selected-naoveio' : '';
            innerHtml += '<div class="check-options" style="margin-top:10px;">' +
                '<div class="check-option' + clsCorrecto + '" data-action="Correto" data-item-index="' + itemIndex + '" onclick="setCheckStatus(\'' + selectedCheckOrderId + '\',' + itemIndex + ',\'Correto\')">Correto</div>' +
                '<div class="check-option' + clsFaltando + '" data-action="Faltando" data-item-index="' + itemIndex + '" onclick="setCheckStatus(\'' + selectedCheckOrderId + '\',' + itemIndex + ',\'Faltando\')">Faltando</div>' +
                '<div class="check-option' + clsNaoveio + '" data-action="Nao veio" data-item-index="' + itemIndex + '" onclick="setCheckStatus(\'' + selectedCheckOrderId + '\',' + itemIndex + ',\'Nao veio\')">Nao veio</div></div>';
            innerHtml += '<div id="faltando-input-' + selectedCheckOrderId + '-' + itemIndex + '" class="' + (cs === 'Faltando' ? '' : 'hidden') + '" style="margin-top:10px;">' +
                '<input type="number" class="input-field" placeholder="Quantidade recebida" value="' + rq + '" onchange="setReceivedQuantity(\'' + selectedCheckOrderId + '\',' + itemIndex + ',this.value)" min="0" max="' + (item.quantity - 1) + '"></div>';
        }
        div.innerHTML = innerHtml;
        container.appendChild(div);
    });
}
function filterCheckItems() {
    if (!selectedCheckOrderId) return;
    const order = cacheOrders.find(function(o) { return o.id === selectedCheckOrderId; });
    if (!order) return;
    renderCheckOrderItems(order, order.status === 'Conferido');
}
function closeCheckDetail() {
    selectedCheckOrderId = null;
    document.getElementById('checkOrderDetail').classList.add('hidden');
    document.getElementById('ordersListToSelect').parentElement.classList.remove('hidden');
    loadOrdersToCheck();
}
async function setCheckStatus(orderId, itemIndex, status) {
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order) return;
    if (!order.checkData) order.checkData = [];
    if (!order.checkData[itemIndex]) order.checkData[itemIndex] = {};
    order.checkData[itemIndex].status = status;
    saveCheckToLocalStorage(orderId, order.checkData);
    fsUpdateOrder(orderId, { checkData: order.checkData }).catch(function(err) {
        console.warn('Erro ao salvar no Firebase, dados salvos localmente:', err);
    });
    updateCheckItemDOM(orderId, itemIndex, status);
}
function updateCheckItemDOM(orderId, itemIndex, status) {
    const container = document.getElementById('checkOrderItems');
    const itemDivs = container.querySelectorAll('.order-item[data-item-index="' + itemIndex + '"]');
    if (itemDivs.length === 0) return;
    const itemDiv = itemDivs[0];
    itemDiv.querySelectorAll('.check-option').forEach(function(opt) {
        opt.classList.remove('selected-correcto', 'selected-faltando', 'selected-naoveio');
        const action = opt.getAttribute('data-action');
        if (action === 'Correto' && status === 'Correto') opt.classList.add('selected-correcto');
        else if (action === 'Faltando' && status === 'Faltando') opt.classList.add('selected-faltando');
        else if (action === 'Nao veio' && status === 'Nao veio') opt.classList.add('selected-naoveio');
    });
    const faltandoInput = document.getElementById('faltando-input-' + orderId + '-' + itemIndex);
    if (faltandoInput) faltandoInput.classList.toggle('hidden', status !== 'Faltando');
}
// ===== LOCALSTORAGE CHECK PERSISTENCE =====
function saveCheckToLocalStorage(orderId, checkData) {
    localStorage.setItem('checkDraft_' + orderId, JSON.stringify({ checkData: checkData, timestamp: Date.now() }));
}
function restoreCheckFromLocalStorage(orderId, order) {
    if (order.status === 'Conferido') return;
    const raw = localStorage.getItem('checkDraft_' + orderId);
    if (!raw) return;
    try {
        const draft = JSON.parse(raw);
        if (draft.checkData && Array.isArray(draft.checkData)) {
            if (!order.checkData) order.checkData = [];
            draft.checkData.forEach(function(cd, i) {
                if (cd && cd.status) {
                    if (!order.checkData[i]) order.checkData[i] = {};
                    if (!order.checkData[i].status) order.checkData[i].status = cd.status;
                    if (cd.receivedQuantity !== undefined && order.checkData[i].receivedQuantity === undefined) {
                        order.checkData[i].receivedQuantity = cd.receivedQuantity;
                    }
                }
            });
            fsUpdateOrder(orderId, { checkData: order.checkData }).catch(function() {});
        }
    } catch(e) { console.warn('Erro ao restaurar check draft:', e); }
}
function clearCheckLocalStorage(orderId) { localStorage.removeItem('checkDraft_' + orderId); }

// ===== CHECK EXTRA PRODUCTS =====
let selectedCheckExtraProduct = null;
function searchCheckExtraProducts() {
    const term = document.getElementById('checkExtraProductSearch').value.toLowerCase();
    const order = cacheOrders.find(function(o) { return o.id === selectedCheckOrderId; });
    if (!order) return;
    const dd = document.getElementById('checkExtraSearchDropdown');
    const estoque = order.estoque || '';
    const filtered = cacheProducts.filter(function(p) {
        return (!estoque || p.estoque === estoque) && p.name.toLowerCase().includes(term);
    });
    filtered.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    if (filtered.length === 0) {
        dd.innerHTML = '<div class="no-results">Nenhum produto encontrado</div>';
        dd.classList.remove('hidden');
        return;
    }
    dd.innerHTML = '';
    filtered.slice(0, 20).forEach(function(p) {
        const item = document.createElement('div');
        item.className = 'search-dropdown-item';
        item.textContent = p.name + ' (' + p.estoque + ')';
        item.onclick = function() { selectCheckExtraProduct(p); };
        dd.appendChild(item);
    });
    dd.classList.remove('hidden');
}
function selectCheckExtraProduct(product) {
    selectedCheckExtraProduct = product;
    document.getElementById('checkExtraProductSearch').value = product.name;
    document.getElementById('checkExtraSearchDropdown').classList.add('hidden');
}
async function addCheckExtraProduct() {
    if (!selectedCheckOrderId) return;
    const order = cacheOrders.find(function(o) { return o.id === selectedCheckOrderId; });
    if (!order) return;
    const productName = document.getElementById('checkExtraProductSearch').value.trim();
    const quantity = parseInt(document.getElementById('checkExtraQuantity').value);
    const type = document.getElementById('checkExtraType').value;
    if (!productName) { alert('Digite ou selecione um produto!'); return; }
    if (!quantity || quantity < 1) { alert('Informe a quantidade!'); return; }
    if (!order.extraProducts) order.extraProducts = [];
    order.extraProducts.push({
        product: productName,
        quantity: quantity,
        type: type,
        estoque: selectedCheckExtraProduct ? selectedCheckExtraProduct.estoque : order.estoque
    });
    await fsUpdateOrder(selectedCheckOrderId, { extraProducts: order.extraProducts });
    document.getElementById('checkExtraProductSearch').value = '';
    document.getElementById('checkExtraQuantity').value = '';
    selectedCheckExtraProduct = null;
    renderCheckExtraProducts(order);
}
async function removeCheckExtraProduct(index) {
    if (!selectedCheckOrderId) return;
    const order = cacheOrders.find(function(o) { return o.id === selectedCheckOrderId; });
    if (!order || !order.extraProducts) return;
    order.extraProducts.splice(index, 1);
    await fsUpdateOrder(selectedCheckOrderId, { extraProducts: order.extraProducts });
    renderCheckExtraProducts(order);
}
function renderCheckExtraProducts(order) {
    const container = document.getElementById('checkExtraProductsList');
    if (!order.extraProducts || order.extraProducts.length === 0) {
        container.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:10px;">Nenhum produto extra adicionado</div>';
        return;
    }
    let html = '';
    order.extraProducts.forEach(function(ep, i) {
        const color = ep.type === 'Veio a mais' ? '#059669' : '#d97706';
        const bgColor = ep.type === 'Veio a mais' ? '#d1fae5' : '#fef3c7';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 15px;background:' + bgColor + ';border-radius:8px;margin-bottom:6px;border-left:3px solid ' + color + ';">' +
            '<div><strong>' + ep.quantity + 'x ' + ep.product + '</strong>' +
            '<span style="margin-left:10px;color:' + color + ';font-size:12px;font-weight:600;">' + ep.type + '</span></div>' +
            '<button class="btn-danger btn-small" onclick="removeCheckExtraProduct(' + i + ')">Remover</button></div>';
    });
    container.innerHTML = html;
}
async function setReceivedQuantity(orderId, itemIndex, quantity) {
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order) return;
    if (!order.checkData) order.checkData = [];
    if (!order.checkData[itemIndex]) order.checkData[itemIndex] = {};
    order.checkData[itemIndex].receivedQuantity = parseInt(quantity);
    saveCheckToLocalStorage(orderId, order.checkData);
    fsUpdateOrder(orderId, { checkData: order.checkData }).catch(function(err) {
        console.warn('Erro ao salvar no Firebase:', err);
    });
}
async function saveCheck() {
    const orderId = selectedCheckOrderId; if (!orderId) return;
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order.checkData || order.checkData.length === 0) { alert('Confira pelo menos um item!'); return; }
    let allChecked = true;
    for (let i = 0; i < order.items.length; i++) { if (!order.checkData[i] || !order.checkData[i].status) { allChecked = false; break; } }
    if (!allChecked) { alert('Confira todos os itens antes de salvar!'); return; }
    await fsUpdateOrder(orderId, { status: 'Conferido', checkData: order.checkData });
    clearCheckLocalStorage(orderId);
    openCheckOrder(orderId); alert('Conferencia salva!');
}
function copyCheckText() {
    const orderId = selectedCheckOrderId; if (!orderId) return;
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order || !order.checkData) { alert('Confira o pedido antes de copiar!'); return; }
    let text = 'Conferido Pedido ' + order.storeName + ' - ' + (order.estoque || 'Sem estoque') + '\nData: ' + order.date + '\n\n';

    if (order.estoque === 'Estoque Nicola') {
        const pelItems = [];
        const prodItems = [];
        order.items.forEach(function(item, index) {
            const entry = { item: item, index: index };
            if (item.nicolaType === 'pel') pelItems.push(entry);
            else prodItems.push(entry);
        });

        function appendCheckLine(entry) {
            const item = entry.item;
            const cd = order.checkData[entry.index];
            let st = cd ? cd.status : 'Nao conferido';
            if (cd && cd.status === 'Faltando' && cd.receivedQuantity !== undefined) st += ' (Recebido: ' + cd.receivedQuantity + ')';
            const qty = item.nicolaType === 'pel' ? (item.quantityCX || item.quantity || 0) : item.quantity;
            const cxLabel = item.nicolaType === 'pel' ? ' CX: ' : ' ';
            text += qty + cxLabel + item.product + (item.others ? ' ' + item.others : '') + ' [' + st + ']\n';
        }

        if (pelItems.length > 0) { text += 'Película:\n'; pelItems.forEach(appendCheckLine); }
        if (prodItems.length > 0) {
            if (pelItems.length > 0) text += '\n';
            text += 'Produto:\n'; prodItems.forEach(appendCheckLine);
        }
    } else {
        order.items.forEach(function(item, index) {
            const cd = order.checkData[index];
            let st = cd ? cd.status : 'Nao conferido';
            if (cd && cd.status === 'Faltando' && cd.receivedQuantity !== undefined) st += ' (Recebido: ' + cd.receivedQuantity + ')';
            let itemText = '';
            if (item.estoque === 'Estoque Capa' && (item.quantityM !== undefined || item.quantityF !== undefined)) {
                itemText = item.product + ': ' + (item.quantityM || 0) + 'M ' + (item.quantityF || 0) + 'F';
            } else {
                itemText = item.quantity + ' ' + item.product;
            }
            text += itemText + (item.others ? ' ' + item.others : '') + ' [' + st + ']\n';
        });
    }
    if (order.extraProducts && order.extraProducts.length > 0) {
        text += '\nPRODUTOS EXTRAS:\n';
        order.extraProducts.forEach(function(ep) {
            text += '- ' + ep.quantity + 'x ' + ep.product + ' [' + ep.type + ']\n';
        });
    }
    navigator.clipboard.writeText(text).then(function() { alert('Conferencia copiada!'); });
}

// ===== STATISTICS =====
function updateStats(page) {
    if (page) statsCurrentPage = page;
    const recent = cacheOrders.slice(-10);
    const container = document.getElementById('statsChart');
    const pag = document.getElementById('statsPagination');
    const sel = document.getElementById('statsEstoque') ? document.getElementById('statsEstoque').value : '';
    if (!container) return;
    if (recent.length === 0) { container.innerHTML = '<div class="empty-state">Sem dados suficientes</div>'; pag.classList.add('hidden'); return; }
    const filtered = sel ? recent.filter(function(o) { return o.estoque === sel; }) : recent;
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">Nenhum pedido encontrado</div>'; pag.classList.add('hidden'); updateProductsWithoutOrders({}, sel); return; }
    const pc = {};
    filtered.forEach(function(o) { o.items.forEach(function(i) { if (!pc[i.product]) pc[i.product] = 0; pc[i.product] += i.quantity; }); });
    const total = Object.values(pc).reduce(function(s, c) { return s + c; }, 0);
    if (total === 0) { container.innerHTML = '<div class="empty-state">Nenhum produto pedido</div>'; pag.classList.add('hidden'); updateProductsWithoutOrders({}, sel); return; }
    const sorted = Object.entries(pc).sort(function(a, b) { return b[1] - a[1]; });
    const totalPages = Math.ceil(sorted.length / statsPerPage);
    if (statsCurrentPage > totalPages) statsCurrentPage = totalPages;
    const start = (statsCurrentPage - 1) * statsPerPage;
    const pageItems = sorted.slice(start, start + statsPerPage);
    let html = '<div class="stats-list-container">';
    pageItems.forEach(function(entry) {
        html += '<div class="stats-list-item"><div class="stats-product-name">' + entry[0] + '</div><div class="stats-percentage">' + ((entry[1] / total) * 100).toFixed(1) + '%</div></div>';
    });
    html += '</div>';
    container.innerHTML = html;
    if (totalPages > 1) {
        pag.classList.remove('hidden');
        pag.innerHTML = '<button class="pagination-btn" onclick="updateStats(' + (statsCurrentPage - 1) + ')"' + (statsCurrentPage === 1 ? ' disabled' : '') + '>Anterior</button>' +
            '<span class="pagination-info">Pagina ' + statsCurrentPage + ' de ' + totalPages + '</span>' +
            '<button class="pagination-btn" onclick="updateStats(' + (statsCurrentPage + 1) + ')"' + (statsCurrentPage === totalPages ? ' disabled' : '') + '>Proxima</button>';
    } else { pag.classList.add('hidden'); }
    updateProductsWithoutOrders(pc, sel);
}
function updateProductsWithoutOrders(pc, sel) {
    const filtered = sel ? cacheProducts.filter(function(p) { return p.estoque === sel; }) : cacheProducts;
    const without = filtered.filter(function(p) { return !pc[p.name]; });
    const container = document.getElementById('productsWithoutOrders');
    if (!container) return;
    if (without.length === 0) { container.innerHTML = '<div class="empty-state">Todos os produtos tiveram pedidos!</div>'; }
    else {
        let html = '<h3 style="color:#d97706;margin-bottom:15px;">Produtos sem Pedidos</h3><div class="product-list">';
        without.forEach(function(p) { html += '<div class="product-item"><div><span class="product-name">' + p.name + '</span><div><span class="product-estoque">' + p.estoque + '</span></div></div></div>'; });
        html += '</div>'; container.innerHTML = html;
    }
}
function toggleProductsWithoutOrders() {
    const c = document.getElementById('productsWithoutOrders');
    const btn = document.getElementById('toggleNoOrdersBtn');
    showingProductsWithoutOrders = !showingProductsWithoutOrders;
    c.classList.toggle('hidden', !showingProductsWithoutOrders);
    btn.textContent = showingProductsWithoutOrders ? 'Ocultar produtos sem pedidos' : 'Ver produtos sem pedidos';
}
function exportStatsReport() {
    const recent = cacheOrders.slice(-10);
    const sel = document.getElementById('statsEstoque').value;
    const storeName = getConfig('storeName') || 'Loja';
    const filtered = sel ? recent.filter(function(o) { return o.estoque === sel; }) : recent;
    const pc = {};
    filtered.forEach(function(o) { o.items.forEach(function(i) { if (!pc[i.product]) pc[i.product] = 0; pc[i.product] += i.quantity; }); });
    const total = Object.values(pc).reduce(function(s, c) { return s + c; }, 0);
    const fp = sel ? cacheProducts.filter(function(p) { return p.estoque === sel; }) : cacheProducts;
    const pwo = fp.filter(function(p) { return !pc[p.name]; });
    let text = 'RELATORIO DE ESTOQUE - ' + (sel || 'Todos') + '\nLoja: ' + storeName + '\nUltimos 10 Pedidos\n' + '='.repeat(40) + '\n\n';
    text += 'PRODUTOS QUE MAIS SAEM:\n';
    if (total > 0) { Object.entries(pc).sort(function(a,b){return b[1]-a[1];}).forEach(function(e) { text += '- ' + e[0] + ' (' + ((e[1]/total)*100).toFixed(1) + '%)\n'; }); }
    else text += '- Nenhum produto pedido\n';
    text += '\nPRODUTOS SEM PEDIDOS:\n';
    if (pwo.length > 0) pwo.forEach(function(p) { text += '- ' + p.name + '\n'; });
    else text += '- Todos os produtos tiveram pedidos\n';
    navigator.clipboard.writeText(text).then(function() { alert('Relatorio copiado!'); });
}

// ===== REPORTS =====
function populateDateSelects() {
    const ms = document.getElementById('reportMonth');
    const ys = document.getElementById('reportYear');
    if (!ms || !ys) return;
    const months = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    ms.innerHTML = '<option value="">Selecione o mes</option>';
    months.forEach(function(m, i) { const o = document.createElement('option'); o.value = i + 1; o.textContent = m; ms.appendChild(o); });
    const years = new Set();
    cacheOrders.forEach(function(o) { try { const d = new Date(o.date.split(', ')[0].split('/').reverse().join('-')); years.add(d.getFullYear()); } catch(e){} });
    if (years.size === 0) years.add(new Date().getFullYear());
    ys.innerHTML = '<option value="">Selecione o ano</option>';
    Array.from(years).sort(function(a,b){return b-a;}).forEach(function(y) { const o = document.createElement('option'); o.value = y; o.textContent = y; ys.appendChild(o); });
}
function ordersOfMonth(month, year) {
    return cacheOrders.filter(function(o) { try { const d = o.date.split(', ')[0].split('/'); return parseInt(d[1]) === month && parseInt(d[2]) === year; } catch(e) { return false; } });
}
function generateMonthlyReport() {
    const month = parseInt(document.getElementById('reportMonth').value);
    const year = parseInt(document.getElementById('reportYear').value);
    const container = document.getElementById('monthlyReportContent');
    if (!month || !year) { alert('Selecione mes e ano!'); return; }
    const mo = ordersOfMonth(month, year);
    if (mo.length === 0) { container.innerHTML = '<div class="empty-state">Nenhum pedido encontrado</div>'; return; }
    const storeName = getConfig('storeName') || 'Loja';
    let totalItems = 0, conferred = 0, pending = 0;
    const ec = {};
    mo.forEach(function(o) {
        if (o.status === 'Conferido') conferred++; else pending++;
        const est = o.estoque || 'Sem estoque'; if (!ec[est]) ec[est] = 0; ec[est]++;
        o.items.forEach(function(i) { totalItems += i.quantity; });
    });
    const monthNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    let html = '<div class="report-summary"><h3 style="color:#1f2937;margin-bottom:15px;">Relatorio de ' + monthNames[month-1] + '/' + year + ' - ' + storeName + '</h3>' +
        '<div class="report-stats">' +
        '<div class="stat-box"><div class="stat-value">' + mo.length + '</div><div class="stat-label">Total Pedidos</div></div>' +
        '<div class="stat-box"><div class="stat-value">' + totalItems + '</div><div class="stat-label">Total Itens</div></div>' +
        '<div class="stat-box"><div class="stat-value">' + conferred + '</div><div class="stat-label">Conferidos</div></div>' +
        '<div class="stat-box"><div class="stat-value">' + pending + '</div><div class="stat-label">Pendentes</div></div></div>' +
        '<div style="margin-top:20px;"><h4 style="color:#374151;margin-bottom:10px;">Pedidos por Estoque</h4><div class="report-stats">';
    Object.entries(ec).sort(function(a,b){return b[1]-a[1];}).forEach(function(e) { html += '<div class="stat-box"><div class="stat-value">' + e[1] + '</div><div class="stat-label">' + e[0] + '</div></div>'; });
    html += '</div></div><button class="btn-export" onclick="exportMonthlyReport(' + month + ',' + year + ')">Exportar Relatorio</button></div>';
    container.innerHTML = html;
}
function exportMonthlyReport(month, year) {
    const mo = ordersOfMonth(month, year);
    const storeName = getConfig('storeName') || 'Loja';
    const monthNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    let totalItems = 0, conferred = 0, pending = 0;
    const pc = {};
    mo.forEach(function(o) {
        if (o.status === 'Conferido') conferred++; else pending++;
        o.items.forEach(function(i) { totalItems += i.quantity; if (!pc[i.product]) pc[i.product] = 0; pc[i.product] += i.quantity; });
    });
    let text = 'RELATORIO MENSAL - ' + monthNames[month-1].toUpperCase() + '/' + year + '\nLoja: ' + storeName + '\nData: ' + new Date().toLocaleString('pt-BR') + '\n' + '='.repeat(40) + '\n\n';
    text += 'RESUMO:\n- Total Pedidos: ' + mo.length + '\n- Total Itens: ' + totalItems + '\n- Conferidos: ' + conferred + '\n- Pendentes: ' + pending + '\n\n';
    text += 'PRODUTOS MAIS PEDIDOS:\n';
    const totalP = Object.values(pc).reduce(function(s,v){return s+v;},0);
    Object.entries(pc).sort(function(a,b){return b[1]-a[1];}).slice(0,10).forEach(function(e) {
        text += '- ' + e[0] + ' (' + ((e[1]/totalP)*100).toFixed(1) + '%)\n';
    });
    navigator.clipboard.writeText(text).then(function() { alert('Relatorio copiado!'); });
}

function getProductsWithoutOrders(estoque) {
    const productsInEstoque = cacheProducts.filter(function(p) { return p.estoque === estoque; });
    const orderedProducts = {};
    cacheOrders.forEach(function(o) {
        o.items.forEach(function(item) {
            if (!orderedProducts[item.product]) orderedProducts[item.product] = 0;
            orderedProducts[item.product] += item.quantity;
        });
    });
    const without = productsInEstoque.filter(function(p) { return !orderedProducts[p.name]; });
    without.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    return { all: productsInEstoque, without: without };
}
function generateNoOrdersReport() {
    const estoque = document.getElementById('reportEstoqueSelector').value;
    const container = document.getElementById('noOrdersReportContent');
    if (!estoque) { alert('Selecione um estoque!'); return; }
    const r = getProductsWithoutOrders(estoque);
    if (r.all.length === 0) { container.innerHTML = '<div class="empty-state">Nenhum produto cadastrado neste estoque.</div>'; return; }
    const totalProducts = r.all.length;
    const withoutOrders = r.without.length;
    const withOrders = totalProducts - withoutOrders;

    let html = '<div class="report-summary">';
    html += '<h3 style="color:#1f2937;margin-bottom:15px;">Produtos sem Pedido - ' + estoque + '</h3>';
    html += '<div class="report-stats">';
    html += '<div class="stat-box"><div class="stat-value">' + totalProducts + '</div><div class="stat-label">Total Produtos</div></div>';
    html += '<div class="stat-box"><div class="stat-value">' + withOrders + '</div><div class="stat-label">Com Pedidos</div></div>';
    html += '<div class="stat-box"><div class="stat-value" style="color:#dc2626;">' + withoutOrders + '</div><div class="stat-label">Sem Pedidos</div></div>';
    html += '</div>';
    html += '<button class="btn-export" onclick="copyNoOrdersReport(\'' + estoque + '\')" style="margin-top:15px;">Copiar Relatorio</button>';
    html += '</div>';

    if (withoutOrders > 0) {
        html += '<div class="report-list" style="margin-top:20px;"><h4 style="color:#dc2626;margin-bottom:12px;">Produtos sem Nenhum Pedido:</h4>';
        r.without.forEach(function(p) {
            html += '<div class="report-item" style="border-left-color:#dc2626;"><div class="report-item-header"><span>' + p.name + '</span></div></div>';
        });
        html += '</div>';
    } else {
        html += '<div style="margin-top:20px;padding:20px;background:#d1fae5;border-radius:8px;text-align:center;color:#065f46;font-weight:600;">Todos os produtos deste estoque tiveram pedidos!</div>';
    }
    container.innerHTML = html;
}
function copyNoOrdersReport(estoque) {
    const r = getProductsWithoutOrders(estoque);
    const storeName = getConfig('storeName') || 'Loja';
    let text = 'RELATORIO DE PRODUTOS SEM PEDIDO\nLoja: ' + storeName + '\nEstoque: ' + estoque + '\nData: ' + new Date().toLocaleString('pt-BR') + '\n' + '='.repeat(40) + '\n\n';
    text += 'Total de produtos no estoque: ' + r.all.length + '\nProdutos sem pedidos: ' + r.without.length + '\n\n';
    if (r.without.length > 0) {
        text += 'PRODUTOS SEM NENHUM PEDIDO:\n';
        r.without.forEach(function(p) { text += '- ' + p.name + '\n'; });
    } else {
        text += 'Todos os produtos deste estoque tiveram pedidos.\n';
    }
    navigator.clipboard.writeText(text).then(function() { alert('Relatorio copiado!'); });
}

// ===== ORDER MANAGEMENT =====
function loadAdminOrders() {
    const container = document.getElementById('adminOrdersList');
    document.getElementById('adminOrderDetail').classList.add('hidden');
    document.getElementById('adminOrdersList').parentElement.classList.remove('hidden');
    selectedAdminOrderId = null;
    const all = cacheOrders.slice().reverse();
    if (all.length === 0) { container.innerHTML = '<div class="empty-state">Nenhum pedido para gerenciar</div>'; return; }
    container.innerHTML = '';
    all.forEach(function(order) {
        const et = order.estoque ? '<span style="background:#eff6ff;color:#2563eb;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">' + order.estoque + '</span>' : '';
        const sc = order.status === 'Pendente' ? 'status-pending' : 'status-checked';
        const ic = order.items.reduce(function(s,i){return s+i.quantity;},0);
        const div = document.createElement('div'); div.className = 'admin-order-card'; div.style.cursor = 'pointer';
        div.onclick = function() { openAdminOrderDetail(order.id); };
        div.innerHTML = '<div class="admin-order-header" style="margin-bottom:0;padding-bottom:0;border-bottom:none;">' +
            '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
            '<span class="order-date">' + order.date + '</span>' + et + '<span class="status-badge ' + sc + '">' + order.status + '</span></div>' +
            '<span style="color:#6b7280;font-size:13px;">' + order.items.length + ' produto(s) | ' + ic + ' un.</span></div>';
        container.appendChild(div);
    });
}
function openAdminOrderDetail(orderId) {
    const order = cacheOrders.find(function(o) { return o.id === orderId; }); if (!order) return;
    selectedAdminOrderId = orderId;
    document.getElementById('adminOrdersList').parentElement.classList.add('hidden');
    document.getElementById('adminOrderDetail').classList.remove('hidden');
    const et = order.estoque ? ' - ' + order.estoque : '';
    const sc = order.status === 'Pendente' ? 'status-pending' : 'status-checked';
    document.getElementById('adminOrderDetailTitle').innerHTML = 'Pedido ' + order.date + et + ' <span class="status-badge ' + sc + '">' + order.status + '</span>';
    document.getElementById('btnEditFromDetail').classList.toggle('hidden', order.status === 'Conferido');
    const container = document.getElementById('adminOrderDetailItems');
    container.innerHTML = '';
    order.items.forEach(function(item) {
        const div = document.createElement('div'); div.className = 'order-item';
        div.innerHTML = '<div class="order-item-info"><strong>' + formatItemDisplay(item) + '</strong>' +
            (item.others ? '<br><small style="color:#6b7280;">' + item.others + '</small>' : '') + '</div>';
        container.appendChild(div);
    });
}
function closeAdminOrderDetail() {
    selectedAdminOrderId = null;
    document.getElementById('adminOrderDetail').classList.add('hidden');
    document.getElementById('adminOrdersList').parentElement.classList.remove('hidden');
    loadAdminOrders();
}
function editFromDetail() { if (selectedAdminOrderId) openEditOrder(selectedAdminOrderId); }
async function deleteFromDetail() {
    if (selectedAdminOrderId) { await deleteOrder(selectedAdminOrderId); closeAdminOrderDetail(); }
}
async function deleteOrder(orderId) {
    if (!confirm('Tem certeza que deseja apagar este pedido?')) return;
    await fsDeleteOrder(orderId);
    loadAdminOrders(); loadOrdersToCheck(); updateStats(); alert('Pedido apagado!');
}
function openEditOrder(orderId) {
    const order = cacheOrders.find(function(o) { return o.id === orderId; });
    if (!order || order.status === 'Conferido') { alert('Este pedido nao pode ser editado!'); return; }
    editingOrderId = orderId;
    editingItems = order.items.map(function(i) { return Object.assign({}, i); });
    document.getElementById('editOrderEstoque').value = order.estoque || '';
    renderEditItems();
    document.getElementById('editOrderModal').classList.remove('hidden');
}
function renderEditItems() {
    const container = document.getElementById('editOrderItems');
    if (editingItems.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:15px;">Nenhum item</div>'; return; }
    container.innerHTML = '';
    editingItems.forEach(function(item, i) {
        const div = document.createElement('div'); div.className = 'edit-item-row';
        div.innerHTML = '<input type="number" class="input-field" value="' + item.quantity + '" min="1" onchange="updateEditItem(' + i + ',\'quantity\',this.value)">' +
            '<input type="text" class="input-field" value="' + item.product + '" onchange="updateEditItem(' + i + ',\'product\',this.value)">' +
            '<input type="text" class="input-field" value="' + (item.others || '') + '" placeholder="Obs" onchange="updateEditItem(' + i + ',\'others\',this.value)">' +
            '<button class="btn-danger btn-small" onclick="removeEditItem(' + i + ')">X</button>';
        container.appendChild(div);
    });
}
function updateEditItem(i, field, value) {
    if (field === 'quantity') {
        const q = parseInt(value);
        editingItems[i].quantity = q;
        if (editingItems[i].nicolaType === 'pel') editingItems[i].quantityCX = q;
    } else editingItems[i][field] = value;
}
function removeEditItem(i) { editingItems.splice(i, 1); renderEditItems(); }
function addItemToEdit() {
    const qty = document.getElementById('editNewQty').value;
    const product = document.getElementById('editProductSearch').value;
    const others = document.getElementById('editNewOthers').value;
    if (!qty || !product) { alert('Preencha quantidade e produto!'); return; }
    editingItems.push({ quantity: parseInt(qty), product: product, others: others });
    document.getElementById('editNewQty').value = '';
    document.getElementById('editProductSearch').value = '';
    document.getElementById('editNewOthers').value = '';
    renderEditItems();
}
async function saveEditOrder() {
    if (editingItems.length === 0) { alert('O pedido precisa ter pelo menos um item!'); return; }
    const order = cacheOrders.find(function(o) { return o.id === editingOrderId; });
    if (!order) return;
    const newItems = editingItems.map(function(i) { return Object.assign({}, i); });
    const newEstoque = document.getElementById('editOrderEstoque').value;
    await fsUpdateOrder(editingOrderId, { items: newItems, estoque: newEstoque });
    closeEditModal(); loadAdminOrders(); loadOrdersToCheck(); updateStats(); alert('Pedido atualizado!');
}
function closeEditModal() {
    document.getElementById('editOrderModal').classList.add('hidden');
    editingOrderId = null; editingItems = [];
}

// ===== FRIDAY ORDER =====
function loadFridayOrder() { renderFridayClientList(); renderFridayProductList(); renderFridayOutOfStockList(); }

function bindFridaySearch(inputId, dropdownId) {
    const term = document.getElementById(inputId).value.toLowerCase();
    const dd = document.getElementById(dropdownId);
    if (!term) { dd.classList.add('hidden'); return; }
    const filtered = cacheProducts.filter(function(p) { return p.name.toLowerCase().includes(term); });
    filtered.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    if (filtered.length === 0) { dd.classList.add('hidden'); return; }
    dd.innerHTML = '';
    filtered.slice(0, 10).forEach(function(p) {
        const item = document.createElement('div');
        item.className = 'search-dropdown-item';
        item.textContent = p.name + ' (' + p.estoque + ')';
        item.onmousedown = function(e) {
            e.preventDefault();
            document.getElementById(inputId).value = p.name;
            dd.classList.add('hidden');
        };
        dd.appendChild(item);
    });
    dd.classList.remove('hidden');
}
function searchFridayClientProducts() { bindFridaySearch('fridayClientProduct', 'fridayClientSearchDropdown'); }
function searchFridayProducts() { bindFridaySearch('fridayProductName', 'fridayProductSearchDropdown'); }

async function addFridayClientProduct() {
    const clientName = document.getElementById('fridayClientName').value.trim();
    const clientPhone = document.getElementById('fridayClientPhone').value.trim();
    const productInput = document.getElementById('fridayClientProduct');
    const qtyInput = document.getElementById('fridayClientQuantity');
    const productName = productInput.value.trim();
    const quantity = parseInt(qtyInput.value) || 1;
    if (!clientName) { alert('Digite o nome do cliente!'); return; }
    if (!productName) { alert('Digite o nome do produto!'); return; }
    if (quantity < 1) { alert('Quantidade invalida!'); return; }
    await fsAddFridayProduct(productName, quantity, clientName, clientPhone, 'client');
    document.getElementById('fridayClientName').value = '';
    document.getElementById('fridayClientPhone').value = '';
    productInput.value = '';
    qtyInput.value = '';
    renderFridayClientList();
}
async function addFridayProduct() {
    const productInput = document.getElementById('fridayProductName');
    const qtyInput = document.getElementById('fridayProductQuantity');
    const productName = productInput.value.trim();
    const quantity = parseInt(qtyInput.value) || 1;
    if (!productName) { alert('Digite o nome do produto!'); return; }
    if (quantity < 1) { alert('Quantidade invalida!'); return; }
    await fsAddFridayProduct(productName, quantity, null, null, 'friday');
    productInput.value = '';
    qtyInput.value = '';
    renderFridayProductList();
}
async function removeFridayProduct(docId) {
    await fsDeleteFridayProduct(docId);
    renderFridayClientList();
    renderFridayProductList();
}
function renderFridayClientList() {
    const container = document.getElementById('fridayClientList');
    const clientProducts = cacheFridayProducts.filter(function(p) { return p.type === 'client'; });
    if (clientProducts.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:20px;">Nenhuma encomenda adicionada</div>'; return; }
    clientProducts.sort(function(a, b) { return (a.clientName || '').toLowerCase().localeCompare((b.clientName || '').toLowerCase()); });
    let html = '';
    clientProducts.forEach(function(p) {
        const qty = p.quantity || 1;
        const phone = p.clientPhone ? ' | Tel: ' + p.clientPhone : '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 15px;background:#f9fafb;border-radius:8px;margin-bottom:6px;border-left:3px solid #2563eb;">' +
            '<div><span style="color:#1f2937;font-weight:600;">' + (p.clientName || 'Sem nome') + phone + '</span><br>' +
            '<span style="color:#6b7280;font-size:13px;">' + qty + 'x ' + p.name + '</span></div>' +
            '<button class="btn-danger btn-small" onclick="removeFridayProduct(\'' + p.id + '\')">X</button></div>';
    });
    container.innerHTML = html;
}
function renderFridayProductList() {
    const container = document.getElementById('fridayProductList');
    const fridayProducts = cacheFridayProducts.filter(function(p) { return p.type === 'friday'; });
    if (fridayProducts.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:20px;">Nenhum produto adicionado</div>'; return; }
    fridayProducts.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    let html = '';
    fridayProducts.forEach(function(p) {
        const qty = p.quantity || 1;
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 15px;background:#f9fafb;border-radius:8px;margin-bottom:6px;border-left:3px solid #059669;">' +
            '<span style="color:#1f2937;"><strong>' + qty + 'x</strong> ' + p.name + '</span>' +
            '<button class="btn-danger btn-small" onclick="removeFridayProduct(\'' + p.id + '\')">X</button></div>';
    });
    container.innerHTML = html;
}
const ESTOQUE_ORDER = ['Estoque Produtos', 'Estoque Nicola', 'Estoque Capa'];
let oosView = [];

// Agrupa por estoque os itens conferidos como "Nao veio" que ainda nao foram removidos da lista
function getOutOfStockGroups() {
    const map = {};
    cacheOrders.forEach(function(o) {
        if (o.status !== 'Conferido' || !o.checkData) return;
        o.items.forEach(function(item, i) {
            const cd = o.checkData[i];
            if (!cd || cd.status !== 'Nao veio' || cd.dismissed) return;
            const est = item.estoque || o.estoque || 'Sem estoque';
            if (!map[est]) map[est] = {};
            if (!map[est][item.product]) map[est][item.product] = [];
            map[est][item.product].push({ orderId: o.id, itemIndex: i });
        });
    });
    const keys = Object.keys(map).sort(function(a, b) {
        const ia = ESTOQUE_ORDER.indexOf(a), ib = ESTOQUE_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return keys.map(function(est) {
        const names = Object.keys(map[est]).sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
        return { estoque: est, products: names.map(function(n) { return { name: n, refs: map[est][n] }; }) };
    });
}
// Mantem a funcao antiga (lista simples de nomes) para uso em outros pontos
function getOutOfStockProducts() {
    const out = [];
    getOutOfStockGroups().forEach(function(g) { g.products.forEach(function(p) { if (!out.includes(p.name)) out.push(p.name); }); });
    return out.sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
}
// Marca como removido (nao altera o historico da conferencia)
async function dismissOutOfStockRefs(refs) {
    const byOrder = {};
    refs.forEach(function(r) { (byOrder[r.orderId] = byOrder[r.orderId] || []).push(r.itemIndex); });
    const batch = db.batch();
    Object.keys(byOrder).forEach(function(id) {
        const o = cacheOrders.find(function(x) { return x.id === id; });
        if (!o) return;
        byOrder[id].forEach(function(i) { o.checkData[i].dismissed = true; });
        batch.update(colOrders.doc(id), { checkData: o.checkData });
    });
    await batch.commit();
}
function outOfStockGroupText(g) {
    let t = g.estoque + ':\n';
    g.products.forEach(function(p) { t += '- ' + p.name + '\n'; });
    return t;
}
function copyText(text, okMsg) {
    navigator.clipboard.writeText(text).then(function() { alert(okMsg); }).catch(function() {
        const ta = document.createElement('textarea'); ta.value = text;
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); alert(okMsg); } catch (e) { alert('Texto:\n\n' + text); }
        document.body.removeChild(ta);
    });
}
function renderFridayOutOfStockList() {
    const container = document.getElementById('fridayOutOfStockList');
    oosView = getOutOfStockGroups();
    const actions = document.getElementById('fridayOutOfStockActions');
    if (oosView.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:20px;">Nenhum produto marcado como "Nao veio"</div>';
        if (actions) actions.classList.add('hidden');
        return;
    }
    if (actions) actions.classList.remove('hidden');
    let html = '';
    oosView.forEach(function(g, gi) {
        html += '<div style="border:1px solid #fecaca;border-radius:10px;padding:14px;margin-bottom:14px;background:#fff;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
            '<strong style="color:#991b1b;">' + g.estoque + ' <span style="color:#6b7280;font-weight:500;font-size:13px;">(' + g.products.length + ')</span></strong>' +
            '<div style="display:flex;gap:8px;">' +
            '<button class="btn-edit btn-small" onclick="copyOutOfStockGroup(' + gi + ')">Copiar</button>' +
            '<button class="btn-danger btn-small" onclick="clearOutOfStockGroup(' + gi + ')">Apagar lista</button></div></div>';
        g.products.forEach(function(p, pi) {
            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#fef2f2;border-radius:8px;margin-bottom:6px;border-left:3px solid #fca5a5;">' +
                '<span style="color:#dc2626;font-weight:600;"></span>' +
                '<button class="btn-danger btn-small" title="Remover da lista" onclick="removeOutOfStockProduct(' + gi + ',' + pi + ')">X</button></div>';
        });
        html += '</div>';
    });
    container.innerHTML = html;
    // nomes inseridos como texto (evita problemas com aspas/HTML)
    const spans = container.querySelectorAll('span[style*="#dc2626"]');
    let k = 0;
    oosView.forEach(function(g) { g.products.forEach(function(p) { spans[k++].textContent = p.name; }); });
}
function copyOutOfStockGroup(gi) {
    const g = oosView[gi]; if (!g) return;
    const storeName = getConfig('storeName') || 'Loja';
    copyText('Produtos Solicitados e Nao Tinha em Estoque - ' + storeName + '\n\n' + outOfStockGroupText(g), 'Lista copiada!');
}
async function clearOutOfStockGroup(gi) {
    const g = oosView[gi]; if (!g) return;
    if (!confirm('Apagar a lista de "' + g.estoque + '"?')) return;
    const refs = [];
    g.products.forEach(function(p) { refs.push.apply(refs, p.refs); });
    await dismissOutOfStockRefs(refs);
    renderFridayOutOfStockList();
}
async function removeOutOfStockProduct(gi, pi) {
    const g = oosView[gi]; if (!g || !g.products[pi]) return;
    await dismissOutOfStockRefs(g.products[pi].refs);
    renderFridayOutOfStockList();
}
function outOfStockFullText() {
    const storeName = getConfig('storeName') || 'Loja';
    let text = 'Produtos Solicitados e Nao Tinha em Estoque - ' + storeName + '\n\n';
    if (oosView.length === 0) return text + 'Nenhum produto em falta\n';
    text += oosView.map(outOfStockGroupText).join('\n');
    return text;
}
function copyOutOfStockAll() {
    oosView = getOutOfStockGroups();
    if (oosView.length === 0) { alert('Nenhum produto em falta para copiar!'); return; }
    copyText(outOfStockFullText(), 'Relatorio completo copiado!');
}
async function clearOutOfStockProducts() {
    oosView = getOutOfStockGroups();
    if (oosView.length === 0) { alert('Nenhum produto em falta para limpar!'); return; }
    if (!confirm('Apagar a lista de TODOS os estoques?')) return;
    const refs = [];
    oosView.forEach(function(g) { g.products.forEach(function(p) { refs.push.apply(refs, p.refs); }); });
    await dismissOutOfStockRefs(refs);
    renderFridayOutOfStockList();
}
function copyFridayReport() {
    const storeName = getConfig('storeName') || 'Loja';
    const clientProducts = cacheFridayProducts.filter(function(p) { return p.type === 'client'; });
    const fridayProducts = cacheFridayProducts.filter(function(p) { return p.type === 'friday'; });
    clientProducts.sort(function(a, b) { return (a.clientName || '').toLowerCase().localeCompare((b.clientName || '').toLowerCase()); });
    fridayProducts.sort(function(a, b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });

    let text = 'Pedido Sexta Feira Loja ' + storeName + '\n\nEncomendas de Clientes:\n';
    if (clientProducts.length > 0) {
        clientProducts.forEach(function(p) {
            const phone = p.clientPhone ? ' [' + p.clientPhone + ']' : '';
            text += p.clientName + phone + ' - ' + (p.quantity || 1) + 'x ' + p.name + '\n';
        });
    } else { text += 'Nenhuma encomenda\n'; }

    text += '\nPedido Sexta Feira:\n';
    if (fridayProducts.length > 0) {
        fridayProducts.forEach(function(p) { text += (p.quantity || 1) + 'x ' + p.name + '\n'; });
    } else { text += 'Nenhum produto\n'; }

    text += '\nProdutos Solicitados e Nao Tinha em Estoque:\n';
    const oosGroups = getOutOfStockGroups();
    text += oosGroups.length > 0 ? oosGroups.map(outOfStockGroupText).join('\n') : 'Nenhum produto em falta\n';

    navigator.clipboard.writeText(text).then(function() { alert('Relatorio copiado!'); });
}
async function clearFridayProducts() {
    if (!confirm('Deseja limpar todos os produtos e encomendas?')) return;
    await fsClearFridayProducts();
    renderFridayClientList();
    renderFridayProductList();
}
async function clearFridayByType(type, emptyMsg, confirmMsg) {
    const list = cacheFridayProducts.filter(function(p) { return p.type === type; });
    if (list.length === 0) { alert(emptyMsg); return; }
    if (!confirm(confirmMsg)) return;
    const batch = db.batch();
    list.forEach(function(p) { batch.delete(colFriday.doc(p.id)); });
    await batch.commit();
    cacheFridayProducts = cacheFridayProducts.filter(function(p) { return p.type !== type; });
}
async function clearFridayClientProducts() {
    await clearFridayByType('client', 'Nenhuma encomenda para limpar!', 'Deseja limpar todas as encomendas de clientes?');
    renderFridayClientList();
}
async function clearFridayOrderProducts() {
    await clearFridayByType('friday', 'Nenhum produto do pedido sexta para limpar!', 'Deseja limpar todos os produtos do pedido sexta?');
    renderFridayProductList();
}
// ===== EXPORT / IMPORT ALL =====
function exportAllData() {
    const data = {
        storeName: getConfig('storeName'),
        products: cacheProducts.map(function(p) { const o = { name: p.name, estoque: p.estoque }; if (p.nicolaType) o.nicolaType = p.nicolaType; return o; }),
        orders: cacheOrders.map(function(o) { return { storeName: o.storeName, estoque: o.estoque, date: o.date, items: o.items, status: o.status, checkData: o.checkData || [], extraProducts: o.extraProducts || [] }; }),
        fridayClientProducts: cacheFridayProducts.map(function(p) {
            const item = { name: p.name, quantity: p.quantity || 1, type: p.type || 'friday' };
            if (p.clientName) item.clientName = p.clientName;
            if (p.clientPhone) item.clientPhone = p.clientPhone;
            return item;
        }),
        exportDate: new Date().toLocaleString('pt-BR'), version: '5.0'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = 'backup_' + (getConfig('storeName') || 'sistema') + '_' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    document.getElementById('importExportStatus').innerHTML = '<span style="color:#059669;font-weight:600;">Dados exportados com sucesso!</span>';
    setTimeout(function() { document.getElementById('importExportStatus').innerHTML = ''; }, 3000);
}
async function importAllData(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.storeName || !data.products || !data.orders) { alert('Arquivo invalido!'); return; }
            if (!confirm('Importar dados de "' + data.storeName + '"?\nExportado em: ' + (data.exportDate || 'Desconhecido') + '\n\nProdutos: ' + data.products.length + '\nPedidos: ' + data.orders.length + '\n\nISTO IRA SUBSTITUIR TODOS OS DADOS!')) return;
            await setConfig('storeName', data.storeName);

            const batchP = db.batch();
            cacheProducts.forEach(function(p) { batchP.delete(colProducts.doc(p.id)); });
            await batchP.commit(); cacheProducts = [];
            for (const p of data.products) await fsAddProduct(p.name, p.estoque || 'Estoque Produtos', p.nicolaType || null);

            const batchO = db.batch();
            cacheOrders.forEach(function(o) { batchO.delete(colOrders.doc(o.id)); });
            await batchO.commit(); cacheOrders = [];
            for (const o of data.orders) await fsAddOrder(o);

            if (data.fridayClientProducts) {
                await fsClearFridayProducts();
                for (const item of data.fridayClientProducts) {
                    if (typeof item === 'string') await fsAddFridayProduct(item, 1, null, null, 'friday');
                    else await fsAddFridayProduct(item.name, item.quantity || 1, item.clientName, item.clientPhone, item.type || 'friday');
                }
            }
            loadStoreName(); loadProducts(); loadOrdersToCheck(); updateStats(); populateDateSelects(); loadAdminOrders();
            document.getElementById('importExportStatus').innerHTML = '<span style="color:#059669;font-weight:600;">Dados importados! ' + data.products.length + ' produtos e ' + data.orders.length + ' pedidos.</span>';
            setTimeout(function() { document.getElementById('importExportStatus').innerHTML = ''; }, 5000);
            alert('Dados importados com sucesso!');
        } catch (err) { console.error(err); alert('Erro ao importar: arquivo invalido.'); }
    };
    reader.readAsText(file); event.target.value = '';
}

// ===== EVENT LISTENERS =====
function saveCheckProgress() {
    if (selectedCheckOrderId) {
        const order = cacheOrders.find(function(o) { return o.id === selectedCheckOrderId; });
        if (order && order.checkData && order.status !== 'Conferido') saveCheckToLocalStorage(selectedCheckOrderId, order.checkData);
    }
}
window.addEventListener('beforeunload', function() {
    if (currentOrderItems.length > 0) autoSaveOrder();
    saveCheckProgress();
});
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        if (currentOrderItems.length > 0) autoSaveOrder();
        saveCheckProgress();
    }
});
