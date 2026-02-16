// Data structure
let appData = {
    settings: {
        userName: '',
        partnerName: ''
    },
    shoppingList: [],
    inventory: [],
    history: [],
    learnedCategories: {}, // Store user's category choices
    groceryLists: [] // New: store previous grocery lists by date
};

let currentEditingItem = null;
let currentEditingType = null; // 'shopping' or 'inventory'

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // Render immediately with whatever data we have
    renderAll();

    // Give Firebase a moment to connect, then upload local data if cloud is empty
    setTimeout(() => {
        uploadLocalDataIfNeeded();
        checkExpiredItems(); // Check for expired items on load
        checkLowStockItems(); // Check for low stock items on load
    }, 1000);

    // Enter key to add item
    document.getElementById('new-item-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addShoppingItem();
    });

    // Enter key to add inventory item
    document.getElementById('new-inventory-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addInventoryItem();
    });

    // Quantity selector buttons
    document.querySelectorAll('.quantity-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove selected class from all buttons
            document.querySelectorAll('.quantity-btn').forEach(b => b.classList.remove('selected'));
            // Add selected class to clicked button
            this.classList.add('selected');
            // Set the value in the input field
            document.getElementById('modal-quantity').value = this.dataset.value;
        });
    });

    // Check for expired items and low stock daily
    setInterval(() => {
        checkExpiredItems();
        checkLowStockItems();
    }, 1000 * 60 * 60); // Check every hour
});

// Load data from localStorage or Firebase
function loadData() {
    try {
        if (typeof isFirebaseEnabled !== 'undefined' && isFirebaseEnabled) {
            loadFromFirebase();
            // Note: cleanupOldNotes() is now called inside loadFromFirebase() callback
        } else {
            loadFromLocalStorage();
            // Clean up old notes format for localStorage
            cleanupOldNotes();
        }
    } catch (error) {
        console.error('שגיאה בטעינת נתונים:', error);
        loadFromLocalStorage();
        cleanupOldNotes();
    }
}

// Clean up old "low stock" notes and convert to new format
function cleanupOldNotes() {
    console.log('🧹 Starting cleanup of old note formats...');
    let cleaned = 0;

    appData.shoppingList.forEach(item => {
        if (!item.notes) return;

        const originalNote = item.notes;

        // If already in perfect format, skip
        if (/^⚠️ קנה \d+ להגיע למינימום!$/.test(item.notes)) {
            return; // Already clean
        }

        let needToBuy = 1;
        const noteLower = item.notes.toLowerCase();

        // Check for old English format (case insensitive): "low stock (current: X, minimum: Y)"
        if (noteLower.includes('low stock')) {
            const minimumMatch = item.notes.match(/minimum[:\s]+(\d+)/i);
            const currentMatch = item.notes.match(/current[:\s]+(\d+)/i);

            if (minimumMatch) {
                const minimum = parseInt(minimumMatch[1]);
                const current = currentMatch ? parseInt(currentMatch[1]) : 0;
                needToBuy = Math.max(1, minimum - current);
            }

            item.notes = `⚠️ קנה ${needToBuy} להגיע למינימום!`;
            cleaned++;
            console.log(`🔧 [${item.name}] "${originalNote}" → "${item.notes}"`);
            return;
        }

        // Check for old Hebrew format: "מלאי נמוך"
        if (item.notes.includes('מלאי נמוך')) {
            const match = item.notes.match(/(\d+)/);
            if (match) {
                needToBuy = parseInt(match[1]);
            }
            item.notes = `⚠️ קנה ${needToBuy} להגיע למינימום!`;
            cleaned++;
            console.log(`🔧 [${item.name}] "${originalNote}" → "${item.notes}"`);
            return;
        }

        // If note is suspiciously long (probably mixed format), clean it
        if (item.notes.length > 35) {
            const match = item.notes.match(/(\d+)/);
            if (match) {
                needToBuy = parseInt(match[1]);
            }
            item.notes = `⚠️ קנה ${needToBuy} להגיע למינימום!`;
            cleaned++;
            console.log(`🔧 [${item.name}] Long note cleaned: "${originalNote}" → "${item.notes}"`);
        }
    });

    if (cleaned > 0) {
        saveData();
        console.log(`✅ Successfully cleaned ${cleaned} old note(s)`);
    } else {
        console.log('ℹ️ No old format notes found - all clean!');
    }
}

// Load from localStorage
function loadFromLocalStorage() {
    const saved = localStorage.getItem('couplesShoppingApp');
    if (saved) {
        const parsed = JSON.parse(saved);
        appData = {
            settings: parsed.settings || { userName: '', partnerName: '' },
            shoppingList: parsed.shoppingList || [],
            inventory: parsed.inventory || [],
            history: parsed.history || [],
            learnedCategories: parsed.learnedCategories || {},
            groceryLists: parsed.groceryLists || [] // NEW: grocery lists
        };
        console.log('✅ נתונים נטענו מהמכשיר');
    } else {
        console.log('📭 אין נתונים שמורים, מתחיל מחדש');
    }
}

// Load from Firebase with real-time sync
function loadFromFirebase() {
    console.log('🔄 מתחבר לענן...');

    db.ref('shoppingData').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data) {
            appData = {
                settings: data.settings || { userName: '', partnerName: '' },
                shoppingList: data.shoppingList || [],
                inventory: data.inventory || [],
                history: data.history || [],
                learnedCategories: data.learnedCategories || {},
                groceryLists: data.groceryLists || [] // NEW: grocery lists
            };
            console.log('☁️ נתונים התעדכנו מהענן');

            // Clean up old notes AFTER data is loaded
            cleanupOldNotes();

            localStorage.setItem('couplesShoppingApp', JSON.stringify(appData));
            renderAll();
        } else {
            console.log('📭 אין נתונים בענן');
            loadFromLocalStorage();
        }
    }, (error) => {
        console.error('❌ שגיאה בחיבור לענן:', error);
        loadFromLocalStorage();
    });
}

// Upload local data to Firebase if cloud is empty
function uploadLocalDataIfNeeded() {
    if (!isFirebaseEnabled || !db) return;

    const localData = localStorage.getItem('couplesShoppingApp');
    if (!localData) return;

    // Check if there's data locally but not in cloud
    db.ref('shoppingData').once('value', (snapshot) => {
        const cloudData = snapshot.val();

        if (!cloudData || (!cloudData.shoppingList && !cloudData.inventory)) {
            // Cloud is empty, upload local data
            const parsed = JSON.parse(localData);
            const hasLocalData = (parsed.shoppingList && parsed.shoppingList.length > 0) ||
                                 (parsed.inventory && parsed.inventory.length > 0);

            if (hasLocalData) {
                console.log('📤 מעלה נתונים מקומיים לענן...');
                db.ref('shoppingData').set(parsed)
                    .then(() => {
                        console.log('✅ נתונים הועלו לענן בהצלחה!');
                        alert('הנתונים שלך הועלו לענן! עכשיו הם יסתנכרנו עם כל המכשירים שלך 🎉');
                    })
                    .catch((error) => {
                        console.error('❌ שגיאה בהעלאת נתונים:', error);
                    });
            }
        }
    });
}

// Save data
function saveData() {
    try {
        const dataString = JSON.stringify(appData);
        localStorage.setItem('couplesShoppingApp', dataString);

        const timestamp = new Date().toISOString();
        localStorage.setItem('couplesShoppingApp_backup', dataString);
        localStorage.setItem('couplesShoppingApp_lastSaved', timestamp);

        // Save to Firebase for real-time sync
        if (typeof isFirebaseEnabled !== 'undefined' && isFirebaseEnabled && db) {
            db.ref('shoppingData').set(appData)
                .then(() => console.log('☁️ נשמר בענן'))
                .catch((error) => console.error('❌ שגיאה בשמירה:', error));
        }

        console.log('💾 נשמר במכשיר');
    } catch (error) {
        console.error('שגיאה בשמירה:', error);
    }
}

// Utility function to format dates
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('he-IL');
}

// Sync categories from inventory to shopping list
function syncCategoriesFromInventory() {
    appData.shoppingList.forEach(shopItem => {
        const inventoryItem = appData.inventory.find(i =>
            i.name.toLowerCase() === shopItem.name.toLowerCase()
        );
        if (inventoryItem && shopItem.category !== inventoryItem.category) {
            console.log(`🔄 Syncing category for "${shopItem.name}": ${shopItem.category} → ${inventoryItem.category}`);
            shopItem.category = inventoryItem.category;
        }
    });
}

// Render all sections
function renderAll() {
    syncCategoriesFromInventory(); // Sync before rendering
    renderShoppingList();
    renderInventory();
    renderGroceryLists();
    updateCounts();
}

// Update badge counts
function updateCounts() {
    const shoppingCount = appData.shoppingList.filter(item => !item.purchased).length;
    const inventoryCount = appData.inventory.length;

    document.getElementById('shopping-count').textContent = shoppingCount;
    document.getElementById('inventory-count').textContent = inventoryCount;
}

// Switch tabs
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');

    // Render history tab when switching to it
    if (tabName === 'history') {
        renderGroceryLists();
    }
}

// Add shopping item
function addShoppingItem() {
    const input = document.getElementById('new-item-input');
    const name = input.value.trim();

    if (!name) return;

    const item = {
        id: Date.now(),
        name: name,
        category: 'Other',
        quantity: 1,
        purchased: false,
        addedBy: appData.settings.userName || 'User',
        addedDate: new Date().toISOString(),
        notes: ''
    };

    appData.shoppingList.push(item);
    saveData();
    renderShoppingList();
    updateCounts();

    input.value = '';
}

// Toggle Shopping Mode
function toggleShoppingMode() {
    const isEnabled = document.getElementById('shopping-mode-toggle').checked;
    document.body.classList.toggle('shopping-mode', isEnabled);
    renderShoppingList();
}

// Update progress bar
function updateProgress() {
    const allItems = appData.shoppingList || [];
    const purchased = allItems.filter(item => item.purchased).length;
    const total = allItems.length;
    const percentage = total > 0 ? Math.round((purchased / total) * 100) : 0;

    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const progressPercentage = document.getElementById('progress-percentage');

    if (progressFill) progressFill.style.width = percentage + '%';
    if (progressText) progressText.textContent = `${purchased} מתוך ${total}`;
    if (progressPercentage) progressPercentage.textContent = percentage + '%';
}

// Render shopping list
function renderShoppingList() {
    console.log('🛒 renderShoppingList - start');

    const container = document.getElementById('shopping-list');
    if (!container) {
        console.error('❌ Container #shopping-list not found!');
        return;
    }

    let items = appData.shoppingList || [];

    // Update progress bar
    updateProgress();

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-shopping-cart"></i>
                <p>אין פריטים ברשימת הקניות</p>
            </div>
        `;
        return;
    }

    // Always render by category for better organization
    renderShoppingListByCategory(items);
}

// Render flat list
function renderShoppingListFlat(items) {
    const container = document.getElementById('shopping-list');
    const unpurchased = items.filter(item => !item.purchased);
    const purchased = items.filter(item => item.purchased);

    container.innerHTML = '';

    unpurchased.forEach(item => {
        container.appendChild(createShoppingItemCard(item));
    });

    if (purchased.length > 0) {
        const separator = document.createElement('div');
        separator.style.margin = '20px 0';
        separator.style.padding = '10px';
        separator.style.background = 'var(--surface-elevated)';
        separator.style.borderRadius = '8px';
        separator.style.textAlign = 'center';
        separator.style.fontSize = '0.9rem';
        separator.style.color = 'var(--text-secondary)';
        separator.textContent = 'נרכשו';
        container.appendChild(separator);

        purchased.forEach(item => {
            container.appendChild(createShoppingItemCard(item));
        });
    }
}

// Render by category
function renderShoppingListByCategory(items) {
    const container = document.getElementById('shopping-list');
    container.innerHTML = '';

    const categoryNames = {
        'Produce': '🥬 ירקות ופירות',
        'Dairy': '🥛 חלב וביצים',
        'Meat': '🥩 בשר ודגים',
        'Pantry': '🥫 מזווה',
        'Canned': '🥫 שימורים',
        'Sauces': '🍯 רטבים וממרחים',
        'Oils': '🫒 שמנים',
        'Frozen': '🧊 קפואים',
        'Bakery': '🍞 לחמים ומאפים',
        'Beverages': '🥤 משקאות',
        'Snacks': '🍿 חטיפים',
        'Household': '🧹 ניקיון ובית',
        'Personal': '🧴 טיפוח אישי',
        'Other': '📦 אחר'
    };

    const categorized = {};
    items.forEach(item => {
        if (!categorized[item.category]) {
            categorized[item.category] = { unpurchased: [], purchased: [] };
        }
        if (item.purchased) {
            categorized[item.category].purchased.push(item);
        } else {
            categorized[item.category].unpurchased.push(item);
        }
    });

    Object.keys(categorized).sort().forEach(category => {
        const data = categorized[category];
        if (data.unpurchased.length === 0 && data.purchased.length === 0) return;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <h3>${categoryNames[category] || category}</h3>
            <span class="category-count">${data.unpurchased.length}</span>
        `;
        container.appendChild(header);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';

        data.unpurchased.forEach(item => {
            itemsDiv.appendChild(createShoppingItemCard(item));
        });

        data.purchased.forEach(item => {
            itemsDiv.appendChild(createShoppingItemCard(item));
        });

        container.appendChild(itemsDiv);
    });
}

// Create shopping item card
function createShoppingItemCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card' + (item.purchased ? ' purchased' : '');

    const isShoppingMode = document.body.classList.contains('shopping-mode');

    card.innerHTML = `
        <div class="item-info" style="flex: 1;">
            <div class="item-name">
                ${escapeHtml(item.name)}
            </div>
            <div class="item-meta">
                ${item.quantity > 1 ? `<span class="item-quantity">כמות: ${item.quantity}</span>` : ''}
                ${item.notes ? `<span style="color: var(--warning); font-weight: 600;">${escapeHtml(item.notes)}</span>` : ''}
            </div>
        </div>
        <div class="item-actions">
            <button class="btn-purchased ${isShoppingMode ? 'shopping-mode-btn' : ''}" onclick="togglePurchased(${item.id})" title="סמן כנרכש">
                ${isShoppingMode ? '✓' : 'נרכש'}
            </button>
            ${!isShoppingMode ? `
                <button class="btn-icon" onclick="editItem(${item.id}, 'shopping')" title="עריכה">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="btn-icon danger" onclick="deleteShoppingItem(${item.id})" title="מחיקה">
                    <i class="ph ph-trash"></i>
                </button>
            ` : ''}
        </div>
    `;

    return card;
}

// Toggle purchased status
function togglePurchased(itemId) {
    const item = appData.shoppingList.find(i => i.id === itemId);
    if (!item) return;

    // Ask user how many they purchased
    const quantityInput = prompt(`כמה קנית מ-"${item.name}"?\n\nהזן כמות (מספר שלם, עשרוני או שבר):`, '1');

    if (quantityInput === null) return; // User cancelled

    const purchasedQuantity = parseFraction(quantityInput);

    if (purchasedQuantity === null || purchasedQuantity <= 0) {
        alert('אנא הזן כמות תקינה (גדולה מ-0)\nדוגמאות: 1, 2.5, 1/2');
        return;
    }

    item.purchased = true;
    item.purchasedBy = appData.settings.userName || 'משתמש';
    item.purchasedDate = new Date().toISOString();

    // Add to history with actual purchased quantity
    appData.history.push({
        id: Date.now(),
        name: item.name,
        category: item.category,
        quantity: purchasedQuantity,
        purchasedBy: item.purchasedBy,
        purchasedDate: item.purchasedDate,
        notes: item.notes
    });

    // Check if item exists in inventory
    const inventoryItem = appData.inventory.find(i =>
        i.name.toLowerCase() === item.name.toLowerCase()
    );

    if (inventoryItem) {
        // Update existing inventory - add the purchased quantity
        inventoryItem.quantity += purchasedQuantity;
        inventoryItem.lastRestocked = item.purchasedDate;
    } else {
        // Create new inventory item with purchased quantity
        appData.inventory.unshift({
            id: Date.now(),
            name: item.name,
            category: item.category,
            quantity: purchasedQuantity,
            minQuantity: 1,
            expirationDate: '',
            lastRestocked: item.purchasedDate,
            notes: item.notes
        });
    }

    // Remove from shopping list immediately
    appData.shoppingList = appData.shoppingList.filter(i => i.id !== itemId);

    saveData();
    renderAll();
}

// Delete shopping item
function deleteShoppingItem(itemId) {
    if (!confirm('Delete this item?')) return;

    appData.shoppingList = appData.shoppingList.filter(i => i.id !== itemId);
    saveData();
    renderAll();
}

// Render inventory
function renderInventory() {
    const container = document.getElementById('inventory-list');
    const filter = document.getElementById('inventory-category-filter').value;

    let items = [...appData.inventory]; // Create copy to avoid mutating original

    // Apply category filter
    if (filter) {
        items = items.filter(item => item.category === filter);
    }

    // Don't sort - keep items in the order they were added (newest first)

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-package"></i>
                <p>אין פריטים במלאי</p>
                <p style="font-size: 0.9rem; margin-top: 10px;">פריטים יופיעו כאן כשתסמן אותם כנרכשו ברשימת הקניות</p>
            </div>
        `;
        return;
    }

    // Render by category
    renderInventoryByCategory(items);
}

// Render inventory by category
function renderInventoryByCategory(items) {
    const container = document.getElementById('inventory-list');
    container.innerHTML = '';

    const categoryNames = {
        'Produce': '🥬 ירקות ופירות',
        'Dairy': '🥛 חלב וביצים',
        'Meat': '🥩 בשר ודגים',
        'Pantry': '🥫 מזווה',
        'Canned': '🥫 שימורים',
        'Sauces': '🍯 רטבים וממרחים',
        'Oils': '🫒 שמנים',
        'Frozen': '🧊 קפואים',
        'Bakery': '🍞 לחמים ומאפים',
        'Beverages': '🥤 משקאות',
        'Snacks': '🍿 חטיפים',
        'Household': '🧹 ניקיון ובית',
        'Personal': '🧴 טיפוח אישי',
        'Other': '📦 אחר'
    };

    // Group by category
    const categorized = {};
    items.forEach(item => {
        if (!categorized[item.category]) {
            categorized[item.category] = [];
        }
        categorized[item.category].push(item);
    });

    // Render each category
    Object.keys(categorized).sort().forEach(category => {
        const categoryItems = categorized[category];
        if (categoryItems.length === 0) return;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.innerHTML = `
            <h3>${categoryNames[category] || category}</h3>
            <span class="category-count">${categoryItems.length}</span>
        `;
        container.appendChild(header);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'category-items';

        categoryItems.forEach(item => {
            const isLowStock = item.quantity <= item.minQuantity;

            const card = document.createElement('div');
            card.className = 'item-card' + (isLowStock ? ' low-stock' : '');

            const isExpired = item.expirationDate && new Date(item.expirationDate) < new Date();
            const daysUntilExpiry = item.expirationDate ? Math.ceil((new Date(item.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;

            // Calculate how many to buy if low stock
            const needToBuy = isLowStock ? Math.ceil((item.minQuantity || 1) - item.quantity) : 0;

            card.innerHTML = `
                <div class="item-info" style="flex: 1;">
                    <div class="item-name">
                        ${escapeHtml(item.name)}
                        ${isLowStock ? ' ⚠️' : ''}
                        ${isExpired ? ' 🚫' : daysUntilExpiry !== null && daysUntilExpiry <= 3 ? ' ⏰' : ''}
                    </div>
                    <div class="item-meta">
                        <span class="item-quantity">כמות: ${item.quantity}</span>
                        <span style="color: var(--text-secondary); cursor: pointer;" onclick="quickEditMinQuantity(${item.id})" title="לחץ לשינוי מינימום">
                            מינימום: ${item.minQuantity || 1} 🔧
                        </span>
                        ${isExpired ? '<span style="color: var(--danger); font-weight: 600;">🚫 פג תוקף</span>' : daysUntilExpiry !== null && daysUntilExpiry <= 3 ? `<span style="color: var(--warning); font-weight: 600;">⏰ פג תוקף בעוד ${daysUntilExpiry} ${daysUntilExpiry === 1 ? 'יום' : 'ימים'}</span>` : item.expirationDate ? `<span style="color: var(--text-tertiary);">📅 תפוגה: ${formatDate(item.expirationDate)}</span>` : ''}
                        ${item.notes ? `<span>📝 ${escapeHtml(item.notes)}</span>` : ''}
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn-icon" onclick="adjustQuantity(${item.id}, -1)" title="הקטן">
                        <i class="ph ph-minus"></i>
                    </button>
                    <button class="btn-icon" onclick="adjustQuantity(${item.id}, 1)" title="הגדל">
                        <i class="ph ph-plus"></i>
                    </button>
                    <button class="btn-icon" onclick="editItem(${item.id}, 'inventory')" title="עריכה">
                        <i class="ph ph-pencil-simple"></i>
                    </button>
                    <button class="btn-icon danger" onclick="deleteInventoryItem(${item.id})" title="מחיקה">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            `;

            itemsDiv.appendChild(card);
        });

        container.appendChild(itemsDiv);
    });
}

// Adjust inventory quantity
function adjustQuantity(itemId, delta) {
    const item = appData.inventory.find(i => i.id === itemId);
    if (!item) return;

    item.quantity = Math.max(0, item.quantity + delta);

    // Check if now low stock
    if (item.quantity <= (item.minQuantity || 1)) {
        // Check if already in shopping list
        const inShoppingList = appData.shoppingList.some(s =>
            s.name.toLowerCase() === item.name.toLowerCase() && !s.purchased
        );

        if (!inShoppingList) {
            // Auto-add to shopping list
            appData.shoppingList.push({
                id: Date.now(),
                name: item.name,
                category: item.category,
                quantity: 1,
                purchased: false,
                addedBy: 'Auto',
                addedDate: new Date().toISOString(),
                notes: `⚠️ קנה ${Math.ceil((item.minQuantity || 1) - item.quantity)} להגיע למינימום!`
            });
        }
    }

    saveData();
    renderAll();
}

// Quick edit minimum quantity
function quickEditMinQuantity(itemId) {
    const item = appData.inventory.find(i => i.id === itemId);
    if (!item) return;

    const currentMin = item.minQuantity || 1;
    const newMin = prompt(`הגדר כמות מינימום עבור "${item.name}":\n\nניתן להזין מספר שלם (2), עשרוני (1.5), או שבר (2/3)\nכשהמלאי מגיע לכמות זו, הפריט יתווסף אוטומטית לרשימת הקניות.`, currentMin);

    if (newMin === null) return; // User cancelled

    const minValue = parseFraction(newMin);
    if (minValue === null || minValue < 0) {
        alert('אנא הזן מספר תקין (0 ומעלה)\nדוגמאות: 2, 1.5, 2/3');
        return;
    }

    item.minQuantity = minValue;

    // Check if we should add to shopping list OR remove from it
    if (item.quantity <= item.minQuantity) {
        // Stock is low - add to shopping list if not already there
        const inShoppingList = appData.shoppingList.some(s =>
            s.name.toLowerCase() === item.name.toLowerCase() && !s.purchased
        );

        if (!inShoppingList) {
            appData.shoppingList.push({
                id: Date.now(),
                name: item.name,
                category: item.category,
                quantity: 1,
                purchased: false,
                addedBy: 'Auto',
                addedDate: new Date().toISOString(),
                notes: `⚠️ קנה ${Math.ceil(newMin - item.quantity)} להגיע למינימום!`
            });
            alert(`${item.name} נוסף לרשימת הקניות (מלאי נוכחי: ${item.quantity}, מינימום: ${newMin})`);
        }
    } else {
        // Stock is sufficient - remove from shopping list if it was auto-added
        const autoAddedIndex = appData.shoppingList.findIndex(s =>
            s.name.toLowerCase() === item.name.toLowerCase() &&
            !s.purchased &&
            s.addedBy === 'Auto'
        );

        if (autoAddedIndex !== -1) {
            appData.shoppingList.splice(autoAddedIndex, 1);
            alert(`${item.name} הוסר מרשימת הקניות (מלאי מספיק: ${item.quantity}, מינימום: ${newMin})`);
        }
    }

    saveData();
    renderAll();
}

// Delete inventory item
function deleteInventoryItem(itemId) {
    if (!confirm('Delete this item from inventory?')) return;

    // Find the item before deleting
    const item = appData.inventory.find(i => i.id === itemId);

    if (item) {
        // Remove from inventory
        appData.inventory = appData.inventory.filter(i => i.id !== itemId);

        // Also remove from shopping list if exists
        appData.shoppingList = appData.shoppingList.filter(s =>
            s.name.toLowerCase() !== item.name.toLowerCase()
        );
    }

    saveData();
    renderAll();
}

// Add item directly to inventory with auto-category detection
function addInventoryItem() {
    const input = document.getElementById('new-inventory-input');
    const name = input.value.trim();

    if (!name) return;

    // Check if item already exists (exact match or partial match)
    const existingItem = appData.inventory.find(i =>
        i.name.toLowerCase() === name.toLowerCase() ||
        i.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(i.name.toLowerCase())
    );

    if (existingItem) {
        // Ask user what to do with duplicate item
        const userChoice = prompt(
            `הפריט "${existingItem.name}" כבר קיים במלאי (כמות: ${existingItem.quantity})\n\n` +
            `מה תרצי לעשות?\n\n` +
            `הקלד:\n` +
            `1 - להוסיף ליחידה קיימת\n` +
            `2 - ליצור פריט חדש\n` +
            `3 - לא להוסיף כלום`,
            '1'
        );

        if (userChoice === '1') {
            // Add to existing item
            existingItem.quantity += 1;
            existingItem.lastRestocked = new Date().toISOString();
            input.value = '';
            saveData();
            renderInventory();
            updateCounts();

            // Open edit modal after render completes
            setTimeout(() => {
                editItem(existingItem.id, 'inventory');
            }, 300);
            return;
        } else if (userChoice === '2') {
            // Continue to create new item below
            // Do nothing here, let the code continue
        } else {
            // User chose 3 or cancelled - don't add anything
            input.value = '';
            return;
        }
    }

    // Auto-detect category
    const category = detectCategory(name);

    const item = {
        id: Date.now(),
        name: name,
        category: category,
        quantity: 1,
        minQuantity: 1,
        expirationDate: '',
        lastRestocked: new Date().toISOString(),
        notes: ''
    };

    // Add to beginning of array (top of list)
    appData.inventory.unshift(item);
    input.value = '';
    saveData();
    renderInventory();
    updateCounts();

    // Automatically open edit modal for the new item after render completes
    setTimeout(() => {
        editItem(item.id, 'inventory');
    }, 300);
}

// Check for expired items and auto-add to shopping list
function checkExpiredItems() {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset to start of day for accurate comparison

    let expiredCount = 0;

    appData.inventory.forEach(item => {
        if (!item.expirationDate) return;

        const expiryDate = new Date(item.expirationDate);
        expiryDate.setHours(0, 0, 0, 0);

        // If item is expired
        if (expiryDate < today) {
            // Check if already in shopping list
            const inShoppingList = appData.shoppingList.some(s =>
                s.name.toLowerCase() === item.name.toLowerCase() && !s.purchased
            );

            if (!inShoppingList) {
                appData.shoppingList.push({
                    id: Date.now() + expiredCount, // Ensure unique IDs
                    name: item.name,
                    category: item.category,
                    quantity: 1,
                    purchased: false,
                    addedBy: 'Auto',
                    addedDate: new Date().toISOString(),
                    notes: `Expired on ${formatDate(item.expirationDate)}`
                });
                expiredCount++;
            }
        }
    });

    if (expiredCount > 0) {
        saveData();
        renderAll();
    }
}

// Check for low stock items and auto-add to shopping list
function checkLowStockItems() {
    let lowStockCount = 0;

    appData.inventory.forEach(item => {
        // Check if item is at or below minimum quantity
        if (item.quantity <= (item.minQuantity || 1)) {
            // Check if already in shopping list
            const inShoppingList = appData.shoppingList.some(s =>
                s.name.toLowerCase() === item.name.toLowerCase() && !s.purchased
            );

            if (!inShoppingList) {
                appData.shoppingList.push({
                    id: Date.now() + lowStockCount, // Ensure unique IDs
                    name: item.name,
                    category: item.category,
                    quantity: 1,
                    purchased: false,
                    addedBy: 'Auto',
                    addedDate: new Date().toISOString(),
                    notes: `⚠️ קנה ${Math.ceil((item.minQuantity || 1) - item.quantity)} להגיע למינימום!`
                });
                lowStockCount++;
            }
        }
    });

    if (lowStockCount > 0) {
        saveData();
        renderAll();
    }
}

// Parse fraction or decimal string to number
function parseFraction(input) {
    if (!input || typeof input !== 'string') {
        const num = parseFloat(input);
        return isNaN(num) ? null : num;
    }

    const trimmed = input.trim();

    // Check if it's a fraction (e.g., "2/3", "1/2")
    if (trimmed.includes('/')) {
        const parts = trimmed.split('/');
        if (parts.length === 2) {
            const numerator = parseFloat(parts[0].trim());
            const denominator = parseFloat(parts[1].trim());
            if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                return numerator / denominator;
            }
        }
        return null;
    }

    // Try to parse as regular number (integer or decimal)
    const num = parseFloat(trimmed);
    return isNaN(num) ? null : num;
}

// Auto-detect category based on item name
function detectCategory(itemName) {
    const name = itemName.toLowerCase().trim();

    // First, check if we've learned a category for this item
    if (appData.learnedCategories && appData.learnedCategories[name]) {
        console.log(`🎓 Using learned category for "${itemName}": ${appData.learnedCategories[name]}`);
        return appData.learnedCategories[name];
    }

    // Check for "שימורים" keyword first (Canned)
    if (name.includes('שימורים') || name.includes('שימור') || name.includes('canned') || name.includes('can ') ||
        name.includes('חומוס') || name.includes('hummus') || name.includes('חמוץ') || name.includes('חמוצים') ||
        name.includes('pickles') || name.includes('מלפפון חמוץ') || name.includes('גרגירים')) {
        return 'Canned';
    }

    // Oils (check before Sauces and Pantry)
    const oils = ['oil', 'olive oil', 'canola', 'vegetable oil', 'coconut oil', 'avocado oil',
                  'shemen', 'שמן', 'שמן זית', 'שמן קנולה', 'שמן צמחי', 'שמן קוקוס', 'שמן אבוקדו'];
    if (oils.some(item => name.includes(item))) return 'Oils';

    // Sauces & Spreads (check before Pantry to prioritize)
    const sauces = ['sauce', 'mayo', 'mayonnaise', 'ketchup', 'mustard', 'soy sauce', 'teriyaki',
                    'hot sauce', 'salsa', 'pesto', 'tahini', 'spread', 'jam', 'jelly', 'honey', 'nutella',
                    'roter', 'mayonez', 'miukal', 'soya', 'טריאקי', 'רוטב', 'ממרח',
                    'מיונז', 'מיוקל', 'סויה', 'טחינה', 'חומץ', 'חרדל', 'ריבה', 'דבש', 'נוטלה'];
    if (sauces.some(item => name.includes(item))) return 'Sauces';

    // Dairy
    const dairy = ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'sour cream', 'cottage cheese', 'egg', 'eggs',
                   'halav', 'gvina', 'chem\'a', 'yogurt', 'shamenet', 'beitza', 'beitzim',
                   'חלב', 'גבינה', 'חמאה', 'יוגורט', 'שמנת', 'ביצה', 'ביצים', 'קוטג'];
    if (dairy.some(item => name.includes(item))) return 'Dairy';

    // Produce (ירקות ופירות)
    const produce = ['apple', 'banana', 'orange', 'tomato', 'lettuce', 'carrot', 'potato', 'onion',
                     'garlic', 'pepper', 'cucumber', 'avocado', 'lemon', 'spinach', 'broccoli', 'fruit', 'vegetable',
                     'eggplant', 'zucchini', 'cabbage', 'celery', 'corn', 'mushroom', 'radish', 'beet',
                     'tapuach', 'banana', 'tapuz', 'agvania', 'chasa', 'gezer', 'tapuach adama',
                     'תפוח', 'בננה', 'תפוז', 'עגבניה', 'עגבניות', 'חסה', 'גזר', 'בצל', 'שום', 'מלפפון', 'אבוקדו',
                     'חציל', 'קישוא', 'כרוב', 'סלרי', 'תירס', 'פטריות', 'צנון', 'סלק', 'חסה', 'פלפל',
                     'ירק', 'פרי', 'ירקות', 'פירות'];
    if (produce.some(item => name.includes(item))) return 'Produce';

    // Meat & Fish
    const meat = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'tuna', 'turkey', 'steak', 'meat',
                  'of', 'bakar', 'dag', 'salmon', 'tuna', 'hodu', 'basar',
                  'עוף', 'בקר', 'דג', 'סלמון', 'טונה', 'הודו', 'בשר'];
    if (meat.some(item => name.includes(item))) return 'Meat';

    // Bakery
    const bakery = ['bread', 'bagel', 'roll', 'baguette', 'croissant', 'challah', 'pita', 'toast',
                    'lechem', 'beigele', 'lachmaniya', 'chalah', 'pita',
                    'לחם', 'בייגל', 'חלה', 'פיתה', 'טוסט', 'לחמניה'];
    if (bakery.some(item => name.includes(item))) return 'Bakery';

    // Beverages
    const beverages = ['water', 'juice', 'soda', 'coffee', 'tea', 'beer', 'wine', 'cola', 'drink',
                       'mayim', 'mitz', 'gazoz', 'kafe', 'te', 'bira', 'yayin',
                       'מים', 'מיץ', 'גזוז', 'קפה', 'תה', 'בירה', 'יין', 'משקה'];
    if (beverages.some(item => name.includes(item))) return 'Beverages';

    // Snacks
    const snacks = ['chips', 'cookies', 'candy', 'chocolate', 'popcorn', 'nuts', 'crackers', 'snack',
                    'seeds', 'sunflower', 'peanuts', 'almonds', 'cashews', 'trail mix', 'granola',
                    'bisli', 'ugiot', 'sukariot', 'shokolad', 'egozim', 'bamba',
                    'ביסלי', 'עוגיות', 'סוכריות', 'שוקולד', 'אגוזים', 'במבה', 'חטיף',
                    'גרעינים', 'גרעיני', 'חמניה', 'בוטנים', 'שקדים', 'קשיו', 'גרנולה'];
    if (snacks.some(item => name.includes(item))) return 'Snacks';

    // Frozen
    const frozen = ['ice cream', 'frozen', 'glida', 'קפוא', 'גלידה', 'קפואים'];
    if (frozen.some(item => name.includes(item))) return 'Frozen';

    // Household
    const household = ['soap', 'shampoo', 'detergent', 'cleaner', 'paper towel', 'toilet paper', 'dish soap',
                       'sabon', 'shampo', 'chavitzat kvisah', 'מנקה', 'ניקוי',
                       'נייר טואלט', 'סבון', 'שמפו', 'חומר ניקוי', 'אבקת כביסה'];
    if (household.some(item => name.includes(item))) return 'Household';

    // Personal Care
    const personal = ['toothpaste', 'toothbrush', 'deodorant', 'lotion', 'razor', 'shaving cream',
                      'mishchat shinaim', 'mivreshet shinaim', 'deodorant',
                      'משחת שיניים', 'דאודורנט', 'מברשת', 'גילוח'];
    if (personal.some(item => name.includes(item))) return 'Personal';

    // Pantry (default for common pantry items)
    const pantry = ['rice', 'pasta', 'flour', 'sugar', 'salt', 'oil', 'spice', 'seasoning', 'coconut cream', 'cream of',
                    'orez', 'pasta', 'kemach', 'sukar', 'melach', 'shemen', 'tavlin',
                    'אורז', 'פסטה', 'קמח', 'סוכר', 'מלח', 'שמן', 'תבלין', 'קרם', 'קוקוס'];
    if (pantry.some(item => name.includes(item))) return 'Pantry';

    // Default
    return 'Other';
}

// Show only low stock items
function showLowStock() {
    const lowStockItems = appData.inventory.filter(item => item.quantity <= item.minQuantity);

    if (lowStockItems.length === 0) {
        alert('No low stock items! 🎉');
        return;
    }

    const message = lowStockItems.map(item =>
        `• ${item.name} (${item.quantity} left, min: ${item.minQuantity})`
    ).join('\n');

    alert(`Low Stock Items:\n\n${message}`);
}

// Render history
function renderHistory() {
    const container = document.getElementById('history-list');
    const dateFilter = document.getElementById('history-date-filter').value;

    let items = [...appData.history];

    // Apply date filter
    if (dateFilter) {
        items = items.filter(item => {
            const itemDate = new Date(item.purchasedDate).toISOString().split('T')[0];
            return itemDate === dateFilter;
        });
    }

    // Sort by date (newest first)
    items.sort((a, b) => new Date(b.purchasedDate) - new Date(a.purchasedDate));

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-clock-counter-clockwise"></i>
                <p>No purchase history yet</p>
            </div>
        `;
        return;
    }

    // Group by date
    const grouped = {};
    items.forEach(item => {
        const date = new Date(item.purchasedDate).toLocaleDateString();
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(item);
    });

    container.innerHTML = '';

    Object.keys(grouped).forEach(date => {
        const group = document.createElement('div');
        group.className = 'history-group';

        let itemsHtml = grouped[date].map(item => `
            <div class="history-item">
                <div>
                    <div class="history-item-name">${escapeHtml(item.name)}</div>
                    <div class="history-item-meta">
                        ${getCategoryEmoji(item.category)} ${getCategoryNameHebrew(item.category)} •
                        כמות: ${item.quantity} •
                        על ידי: ${escapeHtml(item.purchasedBy)}
                    </div>
                </div>
            </div>
        `).join('');

        group.innerHTML = `
            <div class="history-date">📅 ${date}</div>
            ${itemsHtml}
        `;

        container.appendChild(group);
    });
}

// Clear history filter
function clearHistoryFilter() {
    document.getElementById('history-date-filter').value = '';
    renderHistory();
}

// Render statistics

// Edit item
function editItem(itemId, type) {
    currentEditingType = type;

    let item;
    if (type === 'shopping') {
        item = appData.shoppingList.find(i => i.id === itemId);
    } else {
        item = appData.inventory.find(i => i.id === itemId);
    }

    if (!item) return;

    currentEditingItem = item;

    document.getElementById('modal-title').textContent = type === 'shopping' ? 'עריכת פריט קניה' : 'עריכת פריט מלאי';
    document.getElementById('modal-item-name').value = item.name;
    document.getElementById('modal-category').value = item.category;
    document.getElementById('modal-quantity').value = item.quantity;
    document.getElementById('modal-min-quantity').value = item.minQuantity || 1;
    document.getElementById('modal-expiration-date').value = item.expirationDate || '';
    document.getElementById('modal-notes').value = item.notes || '';

    // Update quantity selector buttons
    document.querySelectorAll('.quantity-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (parseFloat(btn.dataset.value) === parseFloat(item.quantity)) {
            btn.classList.add('selected');
        }
    });

    // Show/hide fields for shopping items vs inventory items
    const minQtyField = document.getElementById('modal-min-quantity').parentElement;
    const expirationField = document.getElementById('modal-expiration-date').parentElement;

    if (type === 'shopping') {
        minQtyField.style.display = 'none';
        expirationField.style.display = 'none';
    } else {
        minQtyField.style.display = 'block';
        expirationField.style.display = 'block';
    }

    openModal();
}

// Save item details
function saveItemDetails() {
    if (!currentEditingItem) return;

    const oldName = currentEditingItem.name;
    const newName = document.getElementById('modal-item-name').value.trim();
    const newCategory = document.getElementById('modal-category').value;

    currentEditingItem.name = newName;
    currentEditingItem.category = newCategory;

    // Parse quantity (can be fraction or decimal)
    const qtyInput = document.getElementById('modal-quantity').value.trim();
    const qty = parseFraction(qtyInput);
    currentEditingItem.quantity = qty !== null && qty >= 0 ? qty : 1;

    currentEditingItem.notes = document.getElementById('modal-notes').value.trim();

    if (currentEditingType === 'inventory') {
        const minQtyInput = document.getElementById('modal-min-quantity').value.trim();
        const minQty = parseFraction(minQtyInput);
        currentEditingItem.minQuantity = minQty !== null && minQty >= 0 ? minQty : 1;
        currentEditingItem.expirationDate = document.getElementById('modal-expiration-date').value;

        // Learn the category choice for this item
        const itemKey = newName.toLowerCase().trim();
        appData.learnedCategories[itemKey] = newCategory;
        console.log(`📚 Learned: "${newName}" → ${newCategory}`);

        // Sync category to shopping list if item name changed or category changed
        appData.shoppingList.forEach(shopItem => {
            if (shopItem.name.toLowerCase() === oldName.toLowerCase() ||
                shopItem.name.toLowerCase() === newName.toLowerCase()) {
                shopItem.name = newName; // Update name if changed
                shopItem.category = newCategory; // Update category to match inventory
            }
        });
    }

    saveData();
    renderAll();
    closeModal();
}

// Modal functions
function openModal() {
    document.getElementById('item-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('item-modal').classList.remove('active');
    currentEditingItem = null;
    currentEditingType = null;
}

// Settings
function openSettings() {
    console.log('Settings button clicked!'); // Debug

    document.getElementById('user-name').value = appData.settings.userName || '';
    document.getElementById('partner-name').value = appData.settings.partnerName || '';

    // Show last saved info
    const lastSaved = localStorage.getItem('couplesShoppingApp_lastSaved');
    const infoElement = document.getElementById('last-saved-info');
    if (lastSaved) {
        const date = new Date(lastSaved);
        infoElement.textContent = `שמירה אחרונה: ${date.toLocaleString('he-IL')}`;
    } else {
        infoElement.textContent = 'אין מידע על שמירה אחרונה';
    }

    document.getElementById('settings-modal').classList.add('active');
    console.log('Settings modal should be visible now'); // Debug
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
}

function saveSettings() {
    appData.settings.userName = document.getElementById('user-name').value.trim();
    appData.settings.partnerName = document.getElementById('partner-name').value.trim();

    saveData();
    closeSettings();
}

// Download shopping list as text file
function downloadShoppingList() {
    const unpurchasedItems = appData.shoppingList.filter(item => !item.purchased);

    if (unpurchasedItems.length === 0) {
        alert('רשימת הקניות ריקה!');
        return;
    }

    // Group by category
    const categories = {};
    unpurchasedItems.forEach(item => {
        if (!categories[item.category]) {
            categories[item.category] = [];
        }
        categories[item.category].push(item);
    });

    // Build text content
    let content = '🛒 רשימת קניות\n';
    content += `📅 ${new Date().toLocaleDateString('he-IL')}\n`;
    content += '═'.repeat(40) + '\n\n';

    // Category names in Hebrew
    const categoryNames = {
        'Produce': '🥬 ירקות ופירות',
        'Dairy': '🥛 חלב וביצים',
        'Meat': '🥩 בשר ודגים',
        'Pantry': '🥫 מזווה',
        'Canned': '🥫 שימורים',
        'Sauces': '🍯 רטבים וממרחים',
        'Oils': '🫒 שמנים',
        'Frozen': '🧊 קפואים',
        'Bakery': '🍞 לחמים ומאפים',
        'Beverages': '🥤 משקאות',
        'Snacks': '🍿 חטיפים',
        'Household': '🧹 ניקיון ובית',
        'Personal': '🧴 טיפוח אישי',
        'Other': '📦 אחר'
    };

    // Add items by category
    Object.keys(categories).sort().forEach(category => {
        content += `\n${categoryNames[category] || category}\n`;
        content += '─'.repeat(40) + '\n';

        categories[category].forEach(item => {
            // Check if item exists in inventory
            const inventoryItem = appData.inventory.find(i =>
                i.name.toLowerCase() === item.name.toLowerCase()
            );

            content += `☐ ${item.name}`;

            // Only show inventory quantity if exists
            if (inventoryItem) {
                content += ` (נותר במלאי: ${inventoryItem.quantity})`;
            }

            content += '\n';
        });
    });

    content += '\n' + '═'.repeat(40) + '\n';
    content += `סה"כ פריטים: ${unpurchasedItems.length}\n`;

    // Create and download file with UTF-8 BOM for proper Hebrew display
    const BOM = '\uFEFF'; // UTF-8 BOM (Byte Order Mark)
    const blob = new Blob([BOM + content], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    const filename = `רשימת-קניות-${new Date().toISOString().split('T')[0]}.txt`;
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

function copyLink() {
    // Generate sync link
    const jsonString = JSON.stringify(appData);
    const data = btoa(unescape(encodeURIComponent(jsonString)));
    const link = `${window.location.href.split('?')[0]}?import=${data}`;

    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            alert('✅ הקישור הועתק! עכשיו אפשר להדביק אותו ולשלוח');
        }).catch(() => {
            // Fallback for older browsers
            fallbackCopyLink(link);
        });
    } else {
        fallbackCopyLink(link);
    }
}

function fallbackCopyLink(link) {
    const textarea = document.createElement('textarea');
    textarea.value = link;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert('✅ הקישור הועתק! עכשיו אפשר להדביק אותו ולשלוח');
}

function shareViaWhatsApp() {
    // Generate sync link
    const jsonString = JSON.stringify(appData);
    const data = btoa(unescape(encodeURIComponent(jsonString)));
    const link = `${window.location.href.split('?')[0]}?import=${data}`;

    // Create WhatsApp message
    const message = `היי! אני משתף איתך את רשימת הקניות והמלאי שלנו 🛒\n\nלחץ על הקישור הזה כדי לייבא:\n${link}`;
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/?text=${encodedMessage}`;

    // Open WhatsApp
    window.open(whatsappUrl, '_blank');
}

function importData() {
    const link = document.getElementById('import-link').value.trim();

    if (!link) return;

    try {
        const params = new URLSearchParams(link.split('?')[1]);
        const data = params.get('import');

        if (!data) {
            alert('Invalid link');
            return;
        }

        const imported = JSON.parse(decodeURIComponent(escape(atob(data))));

        if (confirm('This will merge imported data with your current data. Continue?')) {
            // Merge shopping lists
            imported.shoppingList.forEach(item => {
                if (!appData.shoppingList.find(i => i.id === item.id)) {
                    appData.shoppingList.push(item);
                }
            });

            // Merge inventory
            imported.inventory.forEach(item => {
                if (!appData.inventory.find(i => i.id === item.id)) {
                    appData.inventory.push(item);
                }
            });

            // Merge history
            imported.history.forEach(item => {
                if (!appData.history.find(i => i.id === item.id)) {
                    appData.history.push(item);
                }
            });

            saveData();
            renderAll();
            alert('Data imported successfully!');
            closeSettings();
        }
    } catch (error) {
        alert('Failed to import data. Invalid link.');
    }
}

function importFromFile(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);

            // Check if it's a backup file with 'data' property or raw data
            const importedData = imported.data || imported;

            if (!confirm('האם לייבא את הנתונים מהקובץ?\n\nזה ימזג את הנתונים עם הנתונים הקיימים שלך.')) {
                input.value = '';
                return;
            }

            // Merge shopping lists
            if (importedData.shoppingList) {
                importedData.shoppingList.forEach(item => {
                    if (!appData.shoppingList.find(i => i.id === item.id)) {
                        appData.shoppingList.push(item);
                    }
                });
            }

            // Merge inventory
            if (importedData.inventory) {
                importedData.inventory.forEach(item => {
                    if (!appData.inventory.find(i => i.id === item.id)) {
                        appData.inventory.push(item);
                    }
                });
            }

            // Merge history
            if (importedData.history) {
                importedData.history.forEach(item => {
                    if (!appData.history.find(i => i.id === item.id)) {
                        appData.history.push(item);
                    }
                });
            }

            // Merge learned categories
            if (importedData.learnedCategories) {
                appData.learnedCategories = {
                    ...appData.learnedCategories,
                    ...importedData.learnedCategories
                };
            }

            // Merge settings
            if (importedData.settings) {
                if (!appData.settings.userName && importedData.settings.userName) {
                    appData.settings.userName = importedData.settings.userName;
                }
                if (!appData.settings.partnerName && importedData.settings.partnerName) {
                    appData.settings.partnerName = importedData.settings.partnerName;
                }
            }

            saveData();
            renderAll();
            alert('✅ הנתונים יובאו בהצלחה!');
            closeSettings();
        } catch (error) {
            console.error('שגיאה בייבוא נתונים:', error);
            alert('❌ שגיאה בייבוא הנתונים. הקובץ אינו תקין.');
        }
    };
    reader.readAsText(file);

    // Clear the input so the same file can be selected again
    input.value = '';
}

// Download backup file
function downloadBackup() {
    const backup = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        data: appData
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const filename = `shopping-backup-${new Date().toISOString().split('T')[0]}.json`;
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);

    alert('הגיבוי הורד בהצלחה! שמור את הקובץ במקום בטוח.');
}

// Restore from backup file
function restoreBackup(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const backup = JSON.parse(e.target.result);

            if (backup.data) {
                if (!confirm(`האם לשחזר גיבוי מ-${new Date(backup.timestamp).toLocaleString('he-IL')}?\n\nזה ימחק את כל הנתונים הנוכחיים!`)) {
                    return;
                }

                appData = backup.data;
                saveData();
                renderAll();
                alert('הגיבוי שוחזר בהצלחה!');
                closeSettings();
            } else {
                alert('קובץ גיבוי לא תקין!');
            }
        } catch (error) {
            console.error('שגיאה בשחזור גיבוי:', error);
            alert('שגיאה בשחזור הגיבוי. הקובץ אינו תקין.');
        }
    };
    reader.readAsText(file);

    // Clear the input so the same file can be selected again
    input.value = '';
}

function clearAllData() {
    if (!confirm('בטוח? זה ימחק את כל הנתונים!')) return;
    if (!confirm('ממש בטוח? אי אפשר לשחזר את זה!')) return;

    appData = {
        settings: { userName: '', partnerName: '' },
        shoppingList: [],
        inventory: [],
        history: []
    };

    saveData();
    renderAll();
    closeSettings();
}

// Check for import on load
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const importData = params.get('import');

    if (importData) {
        document.getElementById('import-link').value = window.location.href;
        openSettings();
        alert('Link detected! Click "Import" in settings to merge data.');
    }
});

// Helper functions
function getCategoryEmoji(category) {
    const emojis = {
        'Produce': '🥬',
        'Dairy': '🥛',
        'Meat': '🥩',
        'Pantry': '🥫',
        'Canned': '🥫',
        'Sauces': '🍯',
        'Oils': '🫒',
        'Frozen': '🧊',
        'Bakery': '🍞',
        'Beverages': '🥤',
        'Snacks': '🍿',
        'Household': '🧹',
        'Personal': '🧴',
        'Other': '📦'
    };
    return emojis[category] || '📦';
}

function getCategoryNameHebrew(category) {
    const names = {
        'Produce': 'ירקות ופירות',
        'Dairy': 'חלב וביצים',
        'Meat': 'בשר ודגים',
        'Pantry': 'מזווה',
        'Canned': 'שימורים',
        'Sauces': 'רטבים וממרחים',
        'Oils': 'שמנים',
        'Frozen': 'קפואים',
        'Bakery': 'לחמים ומאפים',
        'Beverages': 'משקאות',
        'Snacks': 'חטיפים',
        'Household': 'ניקיון ובית',
        'Personal': 'טיפוח אישי',
        'Other': 'אחר'
    };
    return names[category] || 'אחר';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Voice Recorder Functions
let scannedVoiceItems = [];
let recognition = null;
let isRecording = false;

function openVoiceRecorder() {
    document.getElementById('voice-modal').classList.add('active');
    document.getElementById('voice-recorder-section').style.display = 'block';
    document.getElementById('voice-items-section').style.display = 'none';
    document.getElementById('voice-footer').style.display = 'none';
    scannedVoiceItems = [];

    // Reset UI
    document.getElementById('voice-status').textContent = 'לחץ על המיקרופון והקלט את המוצרים שקנית';
    document.getElementById('voice-transcript').style.display = 'none';
    document.getElementById('transcript-text').textContent = '';
    document.getElementById('voice-record-btn').classList.remove('recording');
}

function closeVoiceModal() {
    if (isRecording && recognition) {
        recognition.stop();
    }
    document.getElementById('voice-modal').classList.remove('active');
    scannedVoiceItems = [];
    isRecording = false;
}

function toggleVoiceRecording() {
    if (!isRecording) {
        startVoiceRecording();
    } else {
        stopVoiceRecording();
    }
}

function startVoiceRecording() {
    // Check if browser supports speech recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert('הדפדפן שלך לא תומך בזיהוי קול. נסי Chrome או Edge.');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'he-IL'; // Hebrew
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = '';

    recognition.onstart = () => {
        isRecording = true;
        document.getElementById('voice-record-btn').classList.add('recording');
        document.getElementById('voice-status').textContent = '🎤 מקליט... דבר עכשיו';
        document.getElementById('voice-status').style.color = 'var(--danger)';
        document.getElementById('voice-transcript').style.display = 'block';
        // Debug panel is always visible now
    };

    recognition.onresult = (event) => {
        console.log('🎙️ onresult triggered, event.results.length:', event.results.length);

        // MOBILE FIX: Only take the LAST (most recent) result
        // Mobile sends multiple duplicate results, we only want the latest one
        if (event.results.length > 0) {
            const lastResult = event.results[event.results.length - 1];
            const transcript = lastResult[0].transcript;
            const isFinal = lastResult.isFinal;

            console.log(`Last result: "${transcript}", isFinal:`, isFinal);

            if (isFinal) {
                // Only update finalTranscript when we get a final result
                finalTranscript = transcript;
            } else {
                // Show interim result but don't save it
                document.getElementById('transcript-text').textContent = transcript;
                return;
            }
        }

        const fullText = finalTranscript;
        console.log('📝 Final transcript:', fullText);
        document.getElementById('transcript-text').textContent = fullText;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
            document.getElementById('voice-status').textContent = 'לא נקלט קול. נסי שוב.';
        } else if (event.error === 'not-allowed') {
            alert('אין הרשאה להשתמש במיקרופון. אפשר גישה במיקרופון בהגדרות הדפדפן.');
        } else {
            document.getElementById('voice-status').textContent = 'שגיאה בהקלטה. נסי שוב.';
        }
        stopVoiceRecording();
    };

    recognition.onend = () => {
        console.log('🔴 Recognition ended. isRecording:', isRecording);

        // If still recording (user didn't click stop), restart recognition
        if (isRecording) {
            console.log('🔄 Auto-restarting recognition...');
            try {
                recognition.start();
            } catch (error) {
                console.error('Failed to restart recognition:', error);
                isRecording = false;
                document.getElementById('voice-record-btn').classList.remove('recording');
            }
            return;
        }

        // User clicked stop - process the transcript
        const transcript = document.getElementById('transcript-text').textContent.trim();
        console.log('📝 Transcript:', transcript);

        if (transcript) {
            console.log('✅ Processing transcript...');
            parseVoiceText(transcript);
        } else {
            console.log('❌ No transcript found');
            document.getElementById('voice-status').textContent = 'לא נקלט טקסט. נסי שוב.';
            document.getElementById('voice-status').style.color = 'var(--text-secondary)';
            document.getElementById('voice-record-btn').classList.remove('recording');
        }
    };

    recognition.start();
}

function stopVoiceRecording() {
    if (recognition) {
        isRecording = false; // Set to false so onend knows user stopped it
        recognition.stop();
        document.getElementById('voice-record-btn').classList.remove('recording');
        document.getElementById('voice-status').textContent = 'עיבוד...';
        document.getElementById('voice-status').style.color = 'var(--text-secondary)';
    }
}

// Helper function to convert plural Hebrew words to singular
function hebrewPluralToSingular(word) {
    // Common plural endings in Hebrew
    const pluralPatterns = [
        { pattern: /ים$/, replacement: '' },      // שזיפים -> שזיף, עגבנים -> עגבני
        { pattern: /ות$/, replacement: 'ה' },     // חסות -> חסה, עגבניות -> עגבניה
        { pattern: /יות$/, replacement: 'יה' },   // מלפפוניות -> מלפפוניה
        { pattern: /אות$/, replacement: 'אה' }    // תפוזאות -> תפוזאה (rare)
    ];

    for (const {pattern, replacement} of pluralPatterns) {
        if (pattern.test(word)) {
            const singular = word.replace(pattern, replacement);
            console.log(`🔄 Converted plural "${word}" → singular "${singular}"`);
            return singular;
        }
    }

    // If no plural pattern found, return as-is
    return word;
}

function parseVoiceText(text) {
    console.log('📝 Starting parseVoiceText with:', text);
    console.log('📝 Text length:', text.length);
    console.log('📝 Text split by spaces:', text.split(/\s+/));

    // MOBILE FIX: Clean up repeated text first
    // "חסה חסה חסה 2" -> "חסה 2"
    const words = text.split(/\s+/);
    const cleanedWords = [];
    let i = 0;

    while (i < words.length) {
        const word = words[i];

        // If this is a number or Hebrew number word, just add it
        if (/^\d+(\.\d+)?$/.test(word) || ['אחד', 'אחת', 'שני', 'שתי', 'שניים', 'שתיים', 'שלוש', 'שלושה', 'ארבע', 'ארבעה', 'חמש', 'חמישה', 'שש', 'שישה', 'שבע', 'שבעה', 'שמונה', 'תשע', 'תשעה', 'עשר', 'עשרה'].includes(word)) {
            cleanedWords.push(word);
            i++;
            continue;
        }

        // If this is a Hebrew word, check if it's repeated ahead
        if (/^[א-ת]+$/.test(word)) {
            // Skip all consecutive duplicates of this word
            let skipCount = 0;
            while (i + skipCount + 1 < words.length && words[i + skipCount + 1] === word) {
                skipCount++;
            }

            // Convert plural to singular before adding
            const singularWord = hebrewPluralToSingular(word);
            cleanedWords.push(singularWord);
            i += skipCount + 1;
            continue;
        }

        // Otherwise just add the word
        cleanedWords.push(word);
        i++;
    }

    const cleanedText = cleanedWords.join(' ');
    console.log('🧹 Cleaned text:', cleanedText);

    // Now parse the cleaned text
    text = cleanedText;

    try {
        const items = [];

        // Hebrew number words mapping
        const hebrewNumbers = {
            'אחד': 1, 'אחת': 1, 'שני': 2, 'שתי': 2, 'שניים': 2, 'שתיים': 2,
            'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5,
            'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9,
            'עשר': 10, 'עשרה': 10, 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50
        };

        // First, try to split by commas
        let segments = text.split(/,|،/).map(s => s.trim()).filter(s => s.length > 0);

        // If no commas found, try to detect item+number patterns in the text
        if (segments.length === 1 && segments[0] === text.trim()) {
            console.log('📋 No commas found, trying smart split...');
            segments = [];

            // Build regex to match Hebrew number words
            const numberWords = Object.keys(hebrewNumbers).join('|');

            // Improved pattern: Look for sequences of Hebrew letters followed by a number
            // This will match: "חסה 4" "עגבנייה שתיים" but NOT create overlaps
            // We look for: [Hebrew word(s)] [number/hebrew-number] and then either space+Hebrew or end of string
            const words = text.split(/\s+/);
            let i = 0;

            while (i < words.length) {
                const word = words[i];

                // Check if current word is a number
                if (/^\d+(\.\d+)?$/.test(word)) {
                    // Pattern: "number item" like "4 חסה"
                    if (i + 1 < words.length && /^[א-ת]+$/.test(words[i + 1])) {
                        segments.push(`${words[i + 1]} ${word}`);
                        i += 2;
                        continue;
                    }
                }

                // Check if current word is a Hebrew number word
                if (hebrewNumbers[word]) {
                    // Pattern: "hebrew-number item" like "שתיים עגבנייה"
                    if (i + 1 < words.length && /^[א-ת]+$/.test(words[i + 1])) {
                        segments.push(`${words[i + 1]} ${word}`);
                        i += 2;
                        continue;
                    }
                }

                // Check if this is a Hebrew word
                if (/^[א-ת]+$/.test(word)) {
                    // Look ahead for a number
                    if (i + 1 < words.length) {
                        const nextWord = words[i + 1];

                        // Pattern: "item number" like "חסה 4"
                        if (/^\d+(\.\d+)?$/.test(nextWord)) {
                            segments.push(`${word} ${nextWord}`);
                            i += 2;
                            continue;
                        }

                        // Pattern: "item hebrew-number" like "חסה ארבע"
                        if (hebrewNumbers[nextWord]) {
                            segments.push(`${word} ${nextWord}`);
                            i += 2;
                            continue;
                        }
                    }

                    // No number found, just add the item with quantity 1
                    segments.push(word);
                    i++;
                    continue;
                }

                // Skip unknown patterns
                i++;
            }

            console.log('📋 Smart split segments:', segments);
        } else {
            console.log('📋 Comma-split segments:', segments);
        }

        // If still no segments, fall back to the whole text
        if (segments.length === 0) {
            segments = [text.trim()];
        }

        for (let segment of segments) {
            segment = segment.trim();
            if (!segment || segment.length < 2) continue;

            let itemName = null;
            let quantity = 1;

            // Pattern 1: "חלב 2" or "אבוקדו 3"
            const pattern1 = segment.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/);
            if (pattern1) {
                itemName = pattern1[1].trim();
                quantity = parseFloat(pattern1[2]);
                console.log('✅ Pattern 1 match:', itemName, quantity);
            }
            // Pattern 2: "2 חלב" or "10 ביצים"
            else if (segment.match(/^\d+/)) {
                const pattern2 = segment.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
                if (pattern2) {
                    quantity = parseFloat(pattern2[1]);
                    itemName = pattern2[2].trim();
                    console.log('✅ Pattern 2 match:', itemName, quantity);
                }
            }
            // Pattern 3: Hebrew numbers like "חלב שניים" or "אחד חציל"
            else {
                let foundNumber = false;
                for (const [word, num] of Object.entries(hebrewNumbers)) {
                    // Try "item number" pattern (e.g., "חלב שניים")
                    const regex1 = new RegExp(`^(.+?)\\s+${word}$`, 'i');
                    const match1 = segment.match(regex1);
                    if (match1) {
                        itemName = match1[1].trim();
                        quantity = num;
                        foundNumber = true;
                        console.log('✅ Pattern 3a match:', itemName, quantity);
                        break;
                    }

                    // Try "number item" pattern (e.g., "שניים חלב")
                    const regex2 = new RegExp(`^${word}\\s+(.+)$`, 'i');
                    const match2 = segment.match(regex2);
                    if (match2) {
                        itemName = match2[1].trim();
                        quantity = num;
                        foundNumber = true;
                        console.log('✅ Pattern 3b match:', itemName, quantity);
                        break;
                    }
                }

                // Pattern 4: No quantity - just item name
                if (!foundNumber) {
                    itemName = segment;
                    quantity = 1;
                    console.log('✅ Pattern 4 match (no quantity):', itemName);
                }
            }

            if (itemName && itemName.length > 1) {
                // Clean up item name - remove currency symbols
                itemName = itemName.replace(/[₪$€£]/g, '').trim();

                // Skip excluded items
                const excludePatterns = [/שקית/i, /גופיה/i];
                if (excludePatterns.some(pattern => pattern.test(itemName))) {
                    console.log('⏭️ Skipping excluded item:', itemName);
                    continue;
                }

                // Check if this item already exists in the array (prevent duplicates)
                const existingItem = items.find(item =>
                    item.name.toLowerCase().trim() === itemName.toLowerCase().trim()
                );

                if (existingItem) {
                    // If item exists, just add to its quantity instead of creating duplicate
                    console.log('📝 Item already exists, adding quantity:', itemName);
                    existingItem.quantity += quantity || 1;
                } else {
                    console.log('➕ Adding new item:', itemName, 'qty:', quantity);
                    items.push({
                        id: Date.now() + items.length,
                        name: itemName,
                        quantity: quantity || 1,
                        category: detectCategory(itemName),
                        confirmed: false
                    });
                }
            }
        }

        console.log('🎯 Total items found:', items.length);

        if (items.length === 0) {
            alert('לא זוהו פריטים. נסי שוב ודבר בצורה ברורה יותר.\n\nדוגמאות:\n• "חלב 2, ביצים 10"\n• "4 חסות, 2 שזיפים"\n• "עגבניה 5 ומלפפון 3"');
            document.getElementById('voice-status').textContent = 'לחץ על המיקרופון והקלט את המוצרים שקנית';
            document.getElementById('voice-status').style.color = 'var(--text-secondary)';
            isRecording = false;
            document.getElementById('voice-record-btn').classList.remove('recording');
            return []; // Return empty array
        }

        scannedVoiceItems = items;
        console.log('✅ About to render items...');
        renderVoiceItems();
        console.log('✅ Render complete!');

        // Return items for smart voice mode
        return items;

    } catch (error) {
        console.error('❌ Error in parseVoiceText:', error);
        alert('שגיאה בעיבוד הטקסט: ' + error.message);
        document.getElementById('voice-status').textContent = 'שגיאה בעיבוד. נסי שוב.';
        document.getElementById('voice-status').style.color = 'var(--danger)';
        isRecording = false;
        document.getElementById('voice-record-btn').classList.remove('recording');

        // Return empty array on error
        return [];
    }
}

function renderVoiceItems() {
    const container = document.getElementById('voice-items-list');

    if (scannedVoiceItems.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">לא נמצאו פריטים</p>';
        return;
    }

    container.innerHTML = '';

    scannedVoiceItems.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'voice-item-card';
        card.id = `voice-item-${item.id}`;

        if (item.editing) {
            card.classList.add('editing');
            card.innerHTML = `
                <div class="voice-item-info">
                    <input type="text" class="voice-item-input" id="edit-name-${item.id}" value="${escapeHtml(item.name)}" placeholder="שם הפריט" />
                    <input type="number" class="voice-item-input" id="edit-quantity-${item.id}" value="${item.quantity}" step="0.1" min="0.1" placeholder="כמות" />
                </div>
                <div class="voice-item-actions">
                    <button class="btn-voice-action confirm" onclick="saveVoiceItemEdit(${item.id})" title="שמור">
                        ✓
                    </button>
                    <button class="btn-voice-action delete" onclick="deleteVoiceItem(${item.id})" title="מחק">
                        🗑️
                    </button>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="voice-item-info">
                    <div class="voice-item-name">${escapeHtml(item.name)}</div>
                    <div class="voice-item-quantity">כמות: ${item.quantity}</div>
                </div>
                <div class="voice-item-actions">
                    ${!item.confirmed ? `
                        <button class="btn-voice-action confirm" onclick="confirmVoiceItem(${item.id})" title="אישור">
                            ✓
                        </button>
                    ` : `
                        <button class="btn-voice-action confirm" style="background: var(--success); color: #000;" title="מאושר">
                            ✓
                        </button>
                    `}
                    <button class="btn-voice-action edit" onclick="editVoiceItem(${item.id})" title="עריכה">
                        ✏️
                    </button>
                    <button class="btn-voice-action delete" onclick="deleteVoiceItem(${item.id})" title="מחק">
                        🗑️
                    </button>
                </div>
            `;
        }

        container.appendChild(card);
    });

    // Show the items section and footer
    document.getElementById('voice-recorder-section').style.display = 'none';
    document.getElementById('voice-items-section').style.display = 'block';
    document.getElementById('voice-footer').style.display = 'flex';
}

function confirmVoiceItem(itemId) {
    const item = scannedVoiceItems.find(i => i.id === itemId);
    if (item) {
        item.confirmed = true;
        renderVoiceItems();
    }
}

function editVoiceItem(itemId) {
    const item = scannedVoiceItems.find(i => i.id === itemId);
    if (item) {
        item.editing = true;
        renderVoiceItems();
    }
}

function saveVoiceItemEdit(itemId) {
    const item = scannedVoiceItems.find(i => i.id === itemId);
    if (item) {
        const newName = document.getElementById(`edit-name-${itemId}`).value.trim();
        const newQuantity = parseFloat(document.getElementById(`edit-quantity-${itemId}`).value);

        if (!newName || newQuantity <= 0) {
            alert('אנא הזן שם וכמות תקינים');
            return;
        }

        item.name = newName;
        item.quantity = newQuantity;
        item.category = detectCategory(newName);
        item.editing = false;
        item.confirmed = true;
        renderVoiceItems();
    }
}

function deleteVoiceItem(itemId) {
    scannedVoiceItems = scannedVoiceItems.filter(i => i.id !== itemId);
    renderVoiceItems();
}

function addVoiceItemsToInventory() {
    if (scannedVoiceItems.length === 0) {
        alert('אין פריטים להוספה');
        return;
    }

    let addedCount = 0;

    scannedVoiceItems.forEach(voiceItem => {
        // Check if item already exists in inventory
        const existingItem = appData.inventory.find(i =>
            i.name.toLowerCase() === voiceItem.name.toLowerCase()
        );

        if (existingItem) {
            // Update existing item
            existingItem.quantity += voiceItem.quantity;
            existingItem.lastRestocked = new Date().toISOString();
        } else {
            // Add new item to inventory
            appData.inventory.unshift({
                id: Date.now() + addedCount,
                name: voiceItem.name,
                category: voiceItem.category,
                quantity: voiceItem.quantity,
                minQuantity: 1,
                expirationDate: '',
                lastRestocked: new Date().toISOString(),
                notes: 'נוסף מהקלטה קולית'
            });
        }

        // Remove from shopping list if exists
        appData.shoppingList = appData.shoppingList.filter(s =>
            s.name.toLowerCase() !== voiceItem.name.toLowerCase()
        );

        addedCount++;
    });

    // Also add to grocery list history
    const itemsForHistory = scannedVoiceItems.map(item => ({
        id: Date.now() + Math.random(),
        name: item.name,
        quantity: item.quantity
    }));
    createGroceryListFromVoice(itemsForHistory);

    saveData();
    renderAll();
    closeVoiceModal();

    alert(`✅ ${addedCount} פריטים נוספו למלאי ולרשימות הקודמות!`);

    // Switch to inventory tab
    switchTab('inventory');
}

// Load sample data for testing (call from console: loadSampleData())
function loadSampleData() {
    console.log('🧪 טוען נתוני דוגמה...');

    // Sample settings
    appData.settings = {
        userName: 'Momo',
        partnerName: 'Snuf'
    };

    // Sample shopping list
    appData.shoppingList = [
        { id: Date.now() + 1, name: 'חלב', category: 'Dairy', quantity: 2, purchased: false, addedBy: 'Momo', addedAt: new Date().toISOString() },
        { id: Date.now() + 2, name: 'לחם', category: 'Bakery', quantity: 1, purchased: false, addedBy: 'Snuf', addedAt: new Date().toISOString() },
        { id: Date.now() + 3, name: 'עגבניות', category: 'Produce', quantity: 1, purchased: false, addedBy: 'Momo', addedAt: new Date().toISOString() },
        { id: Date.now() + 4, name: 'גבינה צהובה', category: 'Dairy', quantity: 1, purchased: false, addedBy: 'Snuf', addedAt: new Date().toISOString() },
        { id: Date.now() + 5, name: 'בננות', category: 'Produce', quantity: 6, purchased: false, addedBy: 'Momo', addedAt: new Date().toISOString() }
    ];

    // Sample inventory with various states
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextMonth = new Date(today);
    nextMonth.setDate(nextMonth.getDate() + 30);

    appData.inventory = [
        { id: Date.now() + 10, name: 'ביצים', category: 'Dairy', quantity: 10, minQuantity: 6, expirationDate: nextWeek.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: 'L גודל' },
        { id: Date.now() + 11, name: 'חלב', category: 'Dairy', quantity: 1, minQuantity: 2, expirationDate: tomorrow.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: '3% שומן' },
        { id: Date.now() + 12, name: 'שמן זית', category: 'Oils', quantity: 0.5, minQuantity: 0.3, expirationDate: nextMonth.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: 'Extra virgin' },
        { id: Date.now() + 13, name: 'אורז', category: 'Pantry', quantity: 2, minQuantity: 1, expirationDate: '', lastRestocked: new Date().toISOString(), notes: 'אורז בסמטי' },
        { id: Date.now() + 14, name: 'פסטה', category: 'Pantry', quantity: 3, minQuantity: 2, expirationDate: nextMonth.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: '' },
        { id: Date.now() + 15, name: 'עגבניות', category: 'Produce', quantity: 4, minQuantity: 2, expirationDate: nextWeek.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: 'שרי' },
        { id: Date.now() + 16, name: 'מלפפון', category: 'Produce', quantity: 0.7, minQuantity: 1, expirationDate: nextWeek.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: 'מיני' },
        { id: Date.now() + 17, name: 'גבינה לבנה', category: 'Dairy', quantity: 2, minQuantity: 1, expirationDate: nextWeek.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: '5%' },
        { id: Date.now() + 18, name: 'לחם', category: 'Bakery', quantity: 1, minQuantity: 1, expirationDate: tomorrow.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: 'לחם מלא' },
        { id: Date.now() + 19, name: 'טונה בשמן', category: 'Canned', quantity: 4, minQuantity: 2, expirationDate: nextMonth.toISOString().split('T')[0], lastRestocked: new Date().toISOString(), notes: '' }
    ];

    // Sample history with various purchases over last 30 days
    appData.history = [];
    for (let i = 0; i < 30; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        // Add 2-5 random purchases per day
        const itemsPerDay = Math.floor(Math.random() * 4) + 2;
        for (let j = 0; j < itemsPerDay; j++) {
            const items = ['חלב', 'לחם', 'ביצים', 'גבינה', 'עגבניות', 'מלפפון', 'בננות', 'תפוחים', 'פסטה', 'אורז', 'שמן זית', 'טונה'];
            const categories = ['Dairy', 'Bakery', 'Dairy', 'Dairy', 'Produce', 'Produce', 'Produce', 'Produce', 'Pantry', 'Pantry', 'Oils', 'Canned'];
            const users = ['Momo', 'Snuf'];

            const randomIndex = Math.floor(Math.random() * items.length);

            appData.history.push({
                id: Date.now() + 100 + (i * 10) + j,
                name: items[randomIndex],
                category: categories[randomIndex],
                quantity: Math.floor(Math.random() * 3) + 1,
                purchasedBy: users[Math.floor(Math.random() * users.length)],
                purchasedAt: date.toISOString()
            });
        }
    }

    // Sample learned categories
    appData.learnedCategories = {
        'חלב': 'Dairy',
        'לחם': 'Bakery',
        'ביצים': 'Dairy',
        'גבינה': 'Dairy',
        'עגבניות': 'Produce',
        'מלפפון': 'Produce',
        'בננות': 'Produce',
        'אורז': 'Pantry',
        'פסטה': 'Pantry',
        'שמן זית': 'Oils'
    };

    saveData();
    renderAll();

    console.log('✅ נתוני דוגמה נטענו בהצלחה!');
    console.log(`📊 רשימת קניות: ${appData.shoppingList.length} פריטים`);
    console.log(`📦 מלאי: ${appData.inventory.length} פריטים`);
    console.log(`📈 היסטוריה: ${appData.history.length} רכישות`);

    alert('✅ נתוני דוגמה נטענו בהצלחה!\n\nכעת תוכלי לראות:\n• 5 פריטים ברשימת הקניות\n• 10 פריטים במלאי\n• 100+ רכישות בהיסטוריה\n• סטטיסטיקות מלאות');
}

// ============================================
// GROCERY LISTS (Previous Shopping Lists)
// ============================================

// Render grocery lists by date
function renderGroceryLists() {
    const container = document.getElementById('grocery-lists-container');

    if (!appData.groceryLists || appData.groceryLists.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="ph ph-receipt"></i>
                <p>אין רשימות קודמות</p>
                <p style="font-size: 0.9rem; margin-top: 10px;">רשימות מהקלטות קוליות יופיעו כאן</p>
            </div>
        `;
        return;
    }

    // Sort by date (newest first)
    const sortedLists = [...appData.groceryLists].sort((a, b) =>
        new Date(b.date) - new Date(a.date)
    );

    container.innerHTML = '';

    sortedLists.forEach(list => {
        const card = document.createElement('div');
        card.className = 'grocery-list-card';
        card.onclick = () => openGroceryListDetail(list.id);

        const date = new Date(list.date);
        const dateStr = date.toLocaleDateString('he-IL', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        card.innerHTML = `
            <div class="grocery-list-header">
                <div>
                    <h3>${dateStr}</h3>
                    ${list.storeName ? `<p class="store-name">🏪 ${escapeHtml(list.storeName)}</p>` : ''}
                </div>
                <div class="grocery-list-count">${list.items.length} פריטים</div>
            </div>
            <div class="grocery-list-preview">
                ${list.items.slice(0, 3).map(item =>
                    `<span class="preview-item">${escapeHtml(item.name)} x${item.quantity}</span>`
                ).join('')}
                ${list.items.length > 3 ? `<span class="preview-more">+${list.items.length - 3} עוד</span>` : ''}
            </div>
        `;

        container.appendChild(card);
    });
}

// Create a new grocery list (from voice recording)
function createGroceryListFromVoice(items) {
    // SAFETY: Initialize groceryLists if it doesn't exist (for old users with cached code)
    if (!appData.groceryLists) {
        console.warn('⚠️ groceryLists was undefined, initializing...');
        appData.groceryLists = [];
    }

    const today = new Date().toISOString().split('T')[0];

    // Check if there's already a list for today
    let existingList = appData.groceryLists.find(list => list.date === today);

    if (existingList) {
        // Add items to existing list
        items.forEach(newItem => {
            const existing = existingList.items.find(i =>
                i.name.toLowerCase() === newItem.name.toLowerCase()
            );
            if (existing) {
                existing.quantity += newItem.quantity;
            } else {
                existingList.items.push(newItem);
            }
        });
    } else {
        // Create new list for today
        appData.groceryLists.push({
            id: Date.now(),
            date: today,
            storeName: '',
            items: items,
            createdAt: new Date().toISOString()
        });
    }

    saveData();
}

// Create new empty grocery list
function createNewGroceryList() {
    const storeName = prompt('שם הסופרמרקט (אופציונלי):');
    const today = new Date().toISOString().split('T')[0];

    appData.groceryLists.push({
        id: Date.now(),
        date: today,
        storeName: storeName || '',
        items: [],
        createdAt: new Date().toISOString()
    });

    saveData();
    renderGroceryLists();

    // Open the new list
    openGroceryListDetail(appData.groceryLists[appData.groceryLists.length - 1].id);
}

// Open grocery list detail view
function openGroceryListDetail(listId) {
    const list = appData.groceryLists.find(l => l.id === listId);
    if (!list) return;

    const modal = document.getElementById('grocery-list-modal');
    const date = new Date(list.date);
    const dateStr = date.toLocaleDateString('he-IL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    document.getElementById('grocery-list-title').textContent = dateStr;
    document.getElementById('grocery-list-store').value = list.storeName || '';
    document.getElementById('grocery-list-store').onchange = () => {
        list.storeName = document.getElementById('grocery-list-store').value;
        saveData();
    };

    modal.dataset.listId = listId;
    renderGroceryListItems(list);
    modal.classList.add('active');
}

function closeGroceryListModal() {
    document.getElementById('grocery-list-modal').classList.remove('active');
    renderGroceryLists();
}

function renderGroceryListItems(list) {
    const container = document.getElementById('grocery-list-items');

    if (list.items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>אין פריטים ברשימה</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';

    list.items.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'grocery-list-item';
        itemDiv.innerHTML = `
            <input type="checkbox" id="check-${item.id}" onchange="toggleGroceryItemSelection(${list.id}, ${item.id})">
            <label for="check-${item.id}" class="item-name">${escapeHtml(item.name)}</label>
            <input type="number" class="item-quantity-input" value="${item.quantity}"
                   onchange="updateGroceryItemQuantity(${list.id}, ${item.id}, this.value)"
                   min="0.1" step="0.1">
            <button class="btn-icon danger" onclick="deleteGroceryItem(${list.id}, ${item.id})" title="מחק">
                <i class="ph ph-trash"></i>
            </button>
        `;
        container.appendChild(itemDiv);
    });
}

function addItemToGroceryList() {
    const listId = parseInt(document.getElementById('grocery-list-modal').dataset.listId);
    const list = appData.groceryLists.find(l => l.id === listId);
    if (!list) return;

    const name = prompt('שם הפריט:');
    if (!name) return;

    const quantity = parseFloat(prompt('כמות:', '1'));
    if (isNaN(quantity) || quantity <= 0) return;

    list.items.push({
        id: Date.now(),
        name: name.trim(),
        quantity: quantity,
        selected: false
    });

    saveData();
    renderGroceryListItems(list);
}

function toggleGroceryItemSelection(listId, itemId) {
    const list = appData.groceryLists.find(l => l.id === listId);
    if (!list) return;

    const item = list.items.find(i => i.id === itemId);
    if (!item) return;

    item.selected = document.getElementById(`check-${itemId}`).checked;
}

function updateGroceryItemQuantity(listId, itemId, newQuantity) {
    const list = appData.groceryLists.find(l => l.id === listId);
    if (!list) return;

    const item = list.items.find(i => i.id === itemId);
    if (!item) return;

    item.quantity = parseFloat(newQuantity) || 1;
    saveData();
}

function deleteGroceryItem(listId, itemId) {
    if (!confirm('למחוק פריט זה?')) return;

    const list = appData.groceryLists.find(l => l.id === listId);
    if (!list) return;

    list.items = list.items.filter(i => i.id !== itemId);
    saveData();
    renderGroceryListItems(list);
}

function addSelectedToShoppingList() {
    const listId = parseInt(document.getElementById('grocery-list-modal').dataset.listId);
    const list = appData.groceryLists.find(l => l.id === listId);
    if (!list) return;

    const selectedItems = list.items.filter(i => i.selected);

    if (selectedItems.length === 0) {
        alert('לא נבחרו פריטים');
        return;
    }

    selectedItems.forEach(item => {
        const existing = appData.shoppingList.find(s =>
            s.name.toLowerCase() === item.name.toLowerCase() && !s.purchased
        );

        if (existing) {
            existing.quantity += item.quantity;
        } else {
            appData.shoppingList.push({
                id: Date.now() + Math.random(),
                name: item.name,
                category: detectCategory(item.name),
                quantity: item.quantity,
                purchased: false,
                addedBy: appData.settings.userName || 'משתמש',
                addedDate: new Date().toISOString(),
                notes: `מרשימה: ${new Date(list.date).toLocaleDateString('he-IL')}`
            });
        }
    });

    saveData();
    renderAll();
    closeGroceryListModal();
    switchTab('shopping');

    alert(`✅ ${selectedItems.length} פריטים נוספו לרשימת הקניות!`);
}

// ============================================
// SMART INVENTORY VOICE RECORDING
// ============================================

let inventoryVoiceRecognition = null;
let isInventoryVoiceRecording = false;
let inventoryFullTranscript = '';
let inventoryProcessedCount = 0; // Track how many results we've processed

function openInventoryVoiceRecorder() {
    document.getElementById('inventory-voice-modal').classList.add('active');
    document.getElementById('inventory-voice-status').textContent = 'לחץ על המיקרופון והתחיל לדבר';
    document.getElementById('inventory-voice-transcript').style.display = 'none';
    document.getElementById('inventory-transcript-text').textContent = '';
    document.getElementById('inventory-voice-actions').style.display = 'none';
    document.getElementById('added-to-inventory-list').textContent = '';
    document.getElementById('added-to-shopping-list').textContent = '';
    document.getElementById('inventory-voice-record-btn').classList.remove('recording');
    inventoryFullTranscript = '';
    inventoryProcessedCount = 0; // Reset counter
}

function closeInventoryVoiceModal() {
    if (isInventoryVoiceRecording && inventoryVoiceRecognition) {
        inventoryVoiceRecognition.stop();
    }
    document.getElementById('inventory-voice-modal').classList.remove('active');
    isInventoryVoiceRecording = false;
    inventoryFullTranscript = '';
}

function toggleInventoryVoiceRecording() {
    if (!isInventoryVoiceRecording) {
        startInventoryVoiceRecording();
    } else {
        stopInventoryVoiceRecording();
    }
}

function startInventoryVoiceRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        alert('הדפדפן שלך לא תומך בזיהוי קול. נסי Chrome או Edge.');
        return;
    }

    inventoryVoiceRecognition = new SpeechRecognition();
    inventoryVoiceRecognition.lang = 'he-IL';
    inventoryVoiceRecognition.continuous = true;
    inventoryVoiceRecognition.interimResults = true;

    inventoryVoiceRecognition.onstart = () => {
        isInventoryVoiceRecording = true;
        document.getElementById('inventory-voice-record-btn').classList.add('recording');
        document.getElementById('inventory-voice-status').textContent = '🎤 מקליט... דבר עכשיו';
        document.getElementById('inventory-voice-status').style.color = 'var(--danger)';
        document.getElementById('inventory-voice-transcript').style.display = 'block';
    };

    inventoryVoiceRecognition.onresult = (event) => {
        // MOBILE FIX: Only process NEW results, not accumulated ones
        console.log(`📥 onresult: total ${event.results.length} results, processed ${inventoryProcessedCount}`);

        // Process only new results
        for (let i = inventoryProcessedCount; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript.trim();
            const isFinal = result.isFinal;

            console.log(`🎙️ [${i}] "${transcript}", isFinal:`, isFinal);

            if (isFinal) {
                // Check for "סיימתי" - stop recording
                if (transcript.toLowerCase().includes('סיימתי')) {
                    console.log('🛑 Detected "סיימתי" - stopping...');
                    stopInventoryVoiceRecording();
                    return;
                }

                // Add to full transcript (only once!)
                inventoryFullTranscript += (inventoryFullTranscript ? ' ' : '') + transcript;
                document.getElementById('inventory-transcript-text').textContent = inventoryFullTranscript;

                // Process the command immediately
                processInventoryVoiceCommand(transcript);

                // Mark as processed
                inventoryProcessedCount = i + 1;
            } else {
                // Show interim result (don't save it)
                document.getElementById('inventory-transcript-text').textContent = inventoryFullTranscript + (inventoryFullTranscript ? ' ' : '') + transcript;
            }
        }
    };

    inventoryVoiceRecognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            alert('אין הרשאה להשתמש במיקרופון. אפשר גישה במיקרופון בהגדרות הדפדפן.');
        }
    };

    inventoryVoiceRecognition.onend = () => {
        // If still recording, restart (continuous mode)
        if (isInventoryVoiceRecording) {
            try {
                // Reset counter when restarting (new recognition session)
                inventoryProcessedCount = 0;
                inventoryVoiceRecognition.start();
            } catch (error) {
                console.error('Failed to restart recognition:', error);
                isInventoryVoiceRecording = false;
                document.getElementById('inventory-voice-record-btn').classList.remove('recording');
            }
        }
    };

    try {
        inventoryVoiceRecognition.start();
    } catch (error) {
        console.error('Failed to start recognition:', error);
        alert('שגיאה בהתחלת ההקלטה');
    }
}

function stopInventoryVoiceRecording() {
    isInventoryVoiceRecording = false;
    if (inventoryVoiceRecognition) {
        inventoryVoiceRecognition.stop();
    }
    document.getElementById('inventory-voice-record-btn').classList.remove('recording');
    document.getElementById('inventory-voice-status').textContent = 'ההקלטה הסתיימה ✅';
    document.getElementById('inventory-voice-status').style.color = 'var(--success)';
}

function processInventoryVoiceCommand(text) {
    console.log('🧠 Processing command:', text);

    const lowerText = text.toLowerCase();

    // Check for "יש לנו" - ADD TO INVENTORY
    if (lowerText.includes('יש לנו') || lowerText.includes('יש לי') || lowerText.includes('קניתי')) {
        const itemsText = text.replace(/יש לנו|יש לי|קניתי/gi, '').trim();
        console.log('📦 Extracted items text for inventory:', itemsText);

        const items = parseVoiceText(itemsText);
        console.log('✅ Parsed items:', items);

        if (items && items.length > 0) {
            addItemsToInventoryFromVoice(items);
        } else {
            console.warn('⚠️ No items parsed from:', itemsText);
        }
    }
    // Check for "נגמר ה" or "חסר לנו" - ADD TO SHOPPING LIST
    else if (lowerText.includes('נגמר') || lowerText.includes('חסר')) {
        const itemsText = text.replace(/נגמר ה|נגמר|חסר לנו|חסר/gi, '').trim();
        console.log('🛒 Extracted items text for shopping:', itemsText);

        const items = parseVoiceText(itemsText);
        console.log('✅ Parsed items:', items);

        if (items && items.length > 0) {
            addItemsToShoppingListFromVoice(items);
        } else {
            console.warn('⚠️ No items parsed from:', itemsText);
        }
    }
}

function addItemsToInventoryFromVoice(items) {
    const addedItems = [];

    items.forEach(item => {
        const existingItem = appData.inventory.find(i =>
            i.name.toLowerCase() === item.name.toLowerCase()
        );

        if (existingItem) {
            existingItem.quantity += item.quantity;
            existingItem.lastRestocked = new Date().toISOString();
        } else {
            appData.inventory.unshift({
                id: Date.now() + Math.random(),
                name: item.name,
                category: item.category,
                quantity: item.quantity,
                minQuantity: 1,
                expirationDate: '',
                lastRestocked: new Date().toISOString(),
                notes: 'נוסף בהקלטה חכמה'
            });
        }

        // Remove from shopping list if exists
        appData.shoppingList = appData.shoppingList.filter(s =>
            s.name.toLowerCase() !== item.name.toLowerCase()
        );

        addedItems.push(`${item.name} (${item.quantity})`);
    });

    saveData();
    renderAll();

    // Show in UI
    document.getElementById('inventory-voice-actions').style.display = 'block';
    const inventoryList = document.getElementById('added-to-inventory-list');
    inventoryList.textContent = addedItems.join(', ');

    console.log('✅ Added to inventory:', addedItems);
}

function addItemsToShoppingListFromVoice(items) {
    const addedItems = [];

    items.forEach(item => {
        const existing = appData.shoppingList.find(s =>
            s.name.toLowerCase() === item.name.toLowerCase() && !s.purchased
        );

        if (existing) {
            existing.quantity += item.quantity;
        } else {
            appData.shoppingList.push({
                id: Date.now() + Math.random(),
                name: item.name,
                category: item.category,
                quantity: item.quantity,
                purchased: false,
                addedBy: appData.settings.userName || 'קולי',
                addedDate: new Date().toISOString(),
                notes: '🎤 נוסף בהקלטה'
            });
        }

        addedItems.push(`${item.name} (${item.quantity})`);
    });

    saveData();
    renderAll();

    // Show in UI
    document.getElementById('inventory-voice-actions').style.display = 'block';
    const shoppingList = document.getElementById('added-to-shopping-list');
    shoppingList.textContent = addedItems.join(', ');

    console.log('🛒 Added to shopping list:', addedItems);
}
