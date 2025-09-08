// 📦 Benodigde modules
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
let clients = [];

// ✅ Middleware
app.use(cors({
    origin: [
        'https://qr-bestelpagina.vercel.app',
        'https://bfe5-143-179-158-36.ngrok-free.app',
        'https://bestel-backend.onrender.com',
        'https://adminoa.vercel.app'
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MongoDB verbinden
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.error('⛔ MongoDB fout:', err));

// ✅ Mongoose modellen
const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    tafel: { type: String }, // ✅ tafel wordt opgeslagen
    producten: [{
        item: { type: String, required: true },
        quantity: { type: Number, required: true },
        opmerking: { type: String }
    }],
    status: { type: String, default: 'Nieuw' },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const Product = mongoose.model('Product', new mongoose.Schema({
    naam: { type: String, required: true },
    prijs: { type: Number, required: true },
    image: { type: String, default: '' }
}));

// 🔧 Nieuw model voor config (aantal tafels)
const ConfigSchema = new mongoose.Schema({
    aantalTafels: { type: Number, required: true, default: 10 }
});
const Config = mongoose.model('Config', ConfigSchema);

// 🆕 Nieuw model voor tafels
const TableSchema = new mongoose.Schema({
    nummer: { type: Number, required: true, unique: true }
});
const Table = mongoose.model('Table', TableSchema);

// 📡 Server-Sent Events (SSE)
function sendNewOrderNotification(order) {
    const data = {
        orderId: order.orderId,
        producten: order.producten,
        status: order.status,
        tafel: order.tafel,
        createdAt: order.createdAt
    };
    clients.forEach(res => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

app.get('/admin/notifications', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.push(res);

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
    });
});

// 📬 Bestelling plaatsen
app.post('/order', async (req, res) => {
    const { producten, tafel } = req.body;

    if (!producten || !Array.isArray(producten) || producten.length === 0) {
        return res.status(400).json({ message: '⛔ Productlijst is verplicht.' });
    }

    // Optioneel: check dat tafel een geldige waarde heeft (string of nummer)
    if (!tafel || tafel === '') {
        return res.status(400).json({ message: '⛔ Tafelnummer is verplicht.' });
    }

    const orderId = 'ORD-' + Date.now();

    try {
        const order = new Order({ orderId, producten, tafel });
        await order.save();

        sendNewOrderNotification(order);
        res.json({ message: '✅ Bestelling opgeslagen', order });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij bestelling', error: err.message });
    }
});

// 🔄 Status bijwerken
app.patch('/admin/order/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ message: '⛔ Status is verplicht.' });
    }

    try {
        const order = await Order.findOneAndUpdate(
            { orderId },
            { status },
            { new: true }
        );

        if (!order) return res.status(404).json({ message: '❌ Bestelling niet gevonden.' });

        res.json({ message: '✅ Status geüpdatet', status });
    } catch (err) {
        res.status(500).json({ message: '⛔ Interne fout', error: err.message });
    }
});

// 📋 Admin overzicht (optioneel)
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        let html = `<table border="1"><tr>
            <th>Order ID</th><th>Tafel</th><th>Item</th><th>Aantal</th>
            <th>Opmerking</th><th>Tijd</th><th>Status</th>
        </tr>`;

        orders.forEach(order => {
            order.producten.forEach(product => {
                html += `<tr>
                    <td>${order.orderId}</td>
                    <td>${order.tafel || ''}</td>
                    <td>${product.item}</td>
                    <td>${product.quantity}</td>
                    <td>${product.opmerking || ''}</td>
                    <td>${new Date(order.createdAt).toLocaleString()}</td>
                    <td>${order.status}</td>
                </tr>`;
            });
        });

        html += '</table>';
        res.send(html);
    } catch (err) {
        res.status(500).send('❌ Fout bij ophalen van bestellingen.');
    }
});

// 📅 Bestellingen op datum
app.get('/admin/orders-by-date', async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ message: '⛔ Datum is verplicht als query parameter (YYYY-MM-DD).' });
    }

    try {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const orders = await Order.find({
            createdAt: { $gte: start, $lte: end }
        }).sort({ createdAt: 1 });

        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij ophalen bestellingen op datum.', error: err.message });
    }
});

// 🆕 Product toevoegen
app.post('/admin/product', async (req, res) => {
    const { naam, prijs, image } = req.body;

    if (!naam || !prijs) {
        return res.status(400).json({ message: '⛔ Naam en prijs zijn verplicht.' });
    }

    try {
        const product = new Product({ naam, prijs, image });
        await product.save();
        res.json({ message: '✅ Product toegevoegd', product });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij toevoegen product', error: err.message });
    }
});

// 📋 Producten ophalen
app.get('/products', async (req, res) => {
    try {
        const producten = await Product.find().sort({ naam: 1 });
        res.json(producten);
    } catch (err) {
        res.status(500).json({ message: '⛔ Kan producten niet ophalen.' });
    }
});

// 🗑️ Product verwijderen
app.delete('/admin/product/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await Product.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ message: '❌ Product niet gevonden.' });
        }
        res.json({ message: '✅ Product verwijderd' });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij verwijderen product', error: err.message });
    }
});

// 🛠️ NIEUW: GET aantal tafels ophalen
app.get('/admin/tafel-aantal', async (req, res) => {
    try {
        let config = await Config.findOne();
        if (!config) {
            config = new Config(); // default 10
            await config.save();
        }
        res.json({ aantalTafels: config.aantalTafels });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij ophalen aantal tafels', error: err.message });
    }
});

// 🛠️ NIEUW: PATCH aantal tafels aanpassen
app.patch('/admin/tafel-aantal', async (req, res) => {
    const { aantalTafels } = req.body;
    if (typeof aantalTafels !== 'number' || aantalTafels < 1) {
        return res.status(400).json({ message: '⛔ Ongeldig aantal tafels opgegeven.' });
    }

    try {
        let config = await Config.findOne();
        if (!config) {
            config = new Config({ aantalTafels });
        } else {
            config.aantalTafels = aantalTafels;
        }
        await config.save();
        res.json({ message: '✅ Aantal tafels geüpdatet', aantalTafels });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij updaten aantal tafels', error: err.message });
    }
});

// 🆕 NIEUW: Tafels ophalen
app.get('/admin/tables', async (req, res) => {
    try {
        const tables = await Table.find().sort({ nummer: 1 });
        res.json(tables);
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij ophalen tafels', error: err.message });
    }
});

// 🆕 NIEUW: Nieuwe tafel toevoegen
app.post('/admin/table', async (req, res) => {
    const { nummer } = req.body;

    if (typeof nummer !== 'number' || nummer < 1) {
        return res.status(400).json({ message: '⛔ Ongeldig tafelnummer' });
    }

    try {
        // Check of tafelnummer al bestaat
        const bestaat = await Table.findOne({ nummer });
        if (bestaat) {
            return res.status(400).json({ message: '⛔ Tafelnummer bestaat al' });
        }

        const table = new Table({ nummer });
        await table.save();

        res.status(201).json({ message: '✅ Tafel toegevoegd', table });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij toevoegen tafel', error: err.message });
    }
});

// 🆕 NIEUW: Tafel verwijderen
app.delete('/admin/table/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const deleted = await Table.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ message: '❌ Tafel niet gevonden' });
        }
        res.json({ message: '✅ Tafel verwijderd' });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij verwijderen tafel', error: err.message });
    }
});

// 🚀 Server starten
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`🚀 Server draait op http://localhost:${port}`);
});
