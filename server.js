// 📦 Vereiste modules
require('dotenv').config(); // Dit moet de allereerste regel zijn

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Stripe SDK importeren

const app = express();

// ✅ CORS middleware (1x en netjes)
const allowedOrigins = [
    'https://qr-bestelpagina.vercel.app',
    'https://bfe5-143-179-158-36.ngrok-free.app',
    'https://bestel-backend.onrender.com',
    'https://adminoa.vercel.app'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like Postman or curl)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = `De CORS policy staat '${origin}' niet toe.`;
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// ✅ Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Verbinding met MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.error('⛔ MongoDB verbindingsfout:', err));

// ✅ Mongoose modellen
const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    type: { type: String, enum: ['takeaway', 'pickup'], required: true },
    kiosk: { type: Number, required: true },  // kiosk op bestelling-niveau
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

// 📡 SSE - Real-time updates
let clients = [];
function sendNewOrderNotification(order) {
    const data = {
        orderId: order.orderId,
        type: order.type,
        kiosk: order.kiosk,
        producten: order.producten,
        status: order.status,
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

// ✅ Producten ophalen
app.get('/products', async (req, res) => {
    try {
        const producten = await Product.find();
        res.json(producten);
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij ophalen van producten.' });
    }
});

// Test route om CORS te checken
app.get('/test-cors', (req, res) => {
    res.json({ message: 'CORS werkt!' });
});

// 📬 Bestelling plaatsen
app.post('/order', async (req, res) => {
    const { producten, type, kiosk } = req.body;

    if (!producten || !Array.isArray(producten) || producten.length === 0) {
        return res.status(400).json({ message: '⛔ Geen producten opgegeven.' });
    }

    if (!type || !['takeaway', 'pickup'].includes(type)) {
        return res.status(400).json({ message: '⛔ Type (takeaway of pickup) is verplicht.' });
    }

    if (!kiosk || typeof kiosk !== 'number') {
        return res.status(400).json({ message: '⛔ Kiosk nummer is verplicht en moet een nummer zijn.' });
    }

    const orderId = 'ORD-' + Date.now();

    try {
        const order = new Order({ orderId, producten, type, kiosk });
        await order.save();

        sendNewOrderNotification(order);
        res.json({ message: '✅ Bestelling geplaatst.', order });
    } catch (err) {
        console.error('Fout bij opslaan bestelling:', err);
        res.status(500).json({ message: '⛔ Fout bij opslaan bestelling.', error: err.message });
    }
});

// 🔄 Status bijwerken (admin)
app.patch('/admin/order/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ message: '⛔ Status is verplicht.' });
    }

    try {
        const order = await Order.findOneAndUpdate({ orderId }, { status }, { new: true });

        if (!order) return res.status(404).json({ message: '❌ Bestelling niet gevonden.' });

        res.json({ message: '✅ Status bijgewerkt', status: order.status });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij updaten status.', error: err.message });
    }
});

// Voeg bovenaan toe als stripe nog niet geïnitialiseerd is

app.post('/connection_token', async (req, res) => {
    try {
        const token = await stripe.terminal.connectionTokens.create();
        res.json({ secret: token.secret });
    } catch (error) {
        console.error('Fout bij aanmaken connection token:', error);
        res.status(500).json({ error: 'Kon connection token niet aanmaken' });
    }
});


// 📋 Admin overzicht
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });

        let html = `<h2>Overzicht Bestellingen</h2><table border="1"><tr>
            <th>Order ID</th><th>Type</th><th>Kiosk</th><th>Item</th><th>Aantal</th>
            <th>Opmerking</th><th>Tijd</th><th>Status</th>
        </tr>`;

        orders.forEach(order => {
            order.producten.forEach(product => {
                html += `<tr>
                    <td>${order.orderId}</td>
                    <td>${order.type}</td>
                    <td>${order.kiosk}</td>
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
        res.status(500).send('⛔ Fout bij ophalen bestellingen.');
    }
});

// 📦 Betaling Intent aanmaken (nieuw endpoint)
app.post('/create-payment-intent', async (req, res) => {
    const { amount } = req.body; // het bedrag wordt in centen verstuurd, bijvoorbeeld 5000 = $50.00

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ message: '⛔ Ongeldig bedrag.' });
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,  // Het bedrag in centen
            currency: 'usd', // De valuta (USD in dit geval)
            payment_method_types: ['card'],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Fout bij aanmaken PaymentIntent:', error);
        res.status(500).json({ message: '⛔ Fout bij het aanmaken van PaymentIntent.' });
    }
});

// 🟢 Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server actief op http://localhost:${PORT}`);
});
