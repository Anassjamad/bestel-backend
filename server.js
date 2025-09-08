// 📦 Benodigde modules
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const path = require('path');
const cors = require('cors');

const app = express();
let clients = [];

// ✅ CORS-instellingen
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

// ✅ MongoDB-verbinding
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.error('⛔ MongoDB fout:', err));

// ✅ Mongoose modellen

const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    tafel: { type: String }, 
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

// 📡 SSE voor live bestellingen
function sendNewOrderNotification(order) {
    clients.forEach(res => {
        res.write(`data: ${JSON.stringify(order)}\n\n`);
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

    const orderId = 'ORD-' + Date.now();

    try {
        const order = new Order({ orderId, producten, tafel }); // ✅ tafel opslaan
        await order.save();

        sendNewOrderNotification(order);
        res.json({ message: '✅ Bestelling opgeslagen', order });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij bestelling', error: err.message });
    }
});


// 🔄 Status van bestelling aanpassen
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

// 📄 Admin HTML overzicht (optioneel)
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        let html = `<table><tr>
            <th>Order ID</th><th>Item</th><th>Aantal</th>
            <th>Opmerking</th><th>Tijd</th><th>Status</th>
        </tr>`;

        orders.forEach(order => {
            order.producten.forEach(product => {
                html += `<tr>
                    <td>${order.orderId}</td>
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

// 📅 Bestellingen ophalen op datum
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

// 🚀 Server starten
const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`🚀 Server draait op http://localhost:${port}`);
});
