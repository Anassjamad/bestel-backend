// 📦 Vereiste modules
require('dotenv').config(); // altijd eerst
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const SibApiV3Sdk = require('sib-api-v3-sdk'); // Brevo SDK

const app = express();

// ✅ Brevo API configuratie
const brevoClient = SibApiV3Sdk.ApiClient.instance;
brevoClient.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;
const brevoEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

// ✅ CORS
const allowedOrigins = [
    'https://qr-bestelpagina.vercel.app',
    'https://bfe5-143-179-158-36.ngrok-free.app',
    'https://bestel-backend.onrender.com',
    'https://js.stripe.com/terminal/v1/terminal.mjs',
    'https://adminoa.vercel.app',
    'https://oalogica-site.vercel.app'
];

app.use(cors({
    origin: function (origin, callback) {
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MongoDB verbinding
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('✅ Verbonden met MongoDB'))
    .catch(err => console.error('⛔ MongoDB verbindingsfout:', err));

// ✅ Mongoose modellen
const OrderSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    type: { type: String, enum: ['takeaway', 'pickup', 'oa-logica'], required: true },
    kiosk: { type: Number, default: 0 },
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

const OALogicaProduct = mongoose.model('OALogicaProduct', new mongoose.Schema({
    naam: { type: String, required: true },
    prijs: { type: Number, required: true },
    image: { type: String, default: '' },
    type: { type: String, enum: ['qr', 'kiosk', 'maatwerk'], required: true },
    features: [{ type: String }]
}));

// 📡 SSE real-time updates
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
    clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
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

// ✅ Product endpoints
app.get('/products', async (req, res) => {
    try {
        const producten = await Product.find();
        res.json(producten);
    } catch {
        res.status(500).json({ message: '⛔ Fout bij ophalen van producten.' });
    }
});

app.post('/oa-logica/products', async (req, res) => {
    const { naam, prijs, image, type, features } = req.body;
    if (!naam || !prijs || !type) return res.status(400).json({ message: 'Naam, prijs en type zijn verplicht.' });

    try {
        const product = new OALogicaProduct({ naam, prijs, image: image || '', type, features: features || [] });
        await product.save();
        res.json({ message: '✅ Product toegevoegd!', product });
    } catch (err) {
        console.error('Fout bij toevoegen product:', err);
        res.status(500).json({ message: '⛔ Fout bij toevoegen product.' });
    }
});

app.get('/oa-logica/products', async (req, res) => {
    try {
        const producten = await OALogicaProduct.find();
        res.json(producten);
    } catch {
        res.status(500).json({ message: '⛔ Fout bij ophalen OA Logica producten.' });
    }
});

// 📬 Helperfunctie voor e-mails via Brevo
async function sendBrevoEmail({ to, subject, html }) {
    const emailData = {
        sender: { name: 'OA Logica', email: 'info@oalogica.nl' },
        to: [{ email: to }],
        subject,
        htmlContent: html
    };

    try {
        await brevoEmailApi.sendTransacEmail(emailData);
        console.log(`✅ E-mail verzonden naar ${to}`);
    } catch (err) {
        console.error('⛔ Fout bij verzenden van e-mail via Brevo:', err.response?.text || err.message);
    }
}

// 📦 Bestelling plaatsen
app.post('/order', async (req, res) => {
    const { producten, type, kiosk } = req.body;
    if (!producten?.length) return res.status(400).json({ message: '⛔ Geen producten opgegeven.' });
    if (!type || !['takeaway', 'pickup'].includes(type)) return res.status(400).json({ message: '⛔ Ongeldig type.' });
    if (typeof kiosk !== 'number') return res.status(400).json({ message: '⛔ Ongeldig kiosknummer.' });

    const orderId = 'ORD-' + Date.now();
    try {
        const order = new Order({ orderId, producten, type, kiosk });
        await order.save();
        sendNewOrderNotification(order);
        res.json({ message: '✅ Bestelling geplaatst.', order });
    } catch (err) {
        console.error('Fout bij bestelling:', err);
        res.status(500).json({ message: '⛔ Fout bij opslaan bestelling.' });
    }
});

// 📬 OA Logica bestelling met bevestiging
app.post('/oa-logica/order', async (req, res) => {
    const { naam, email, telefoon, productId, quantity, integratie, opmerking } = req.body;
    if (!naam || !email || !productId || !quantity || !integratie)
        return res.status(400).json({ message: 'Naam, email, product, aantal en integratie zijn verplicht.' });

    try {
        const product = await OALogicaProduct.findById(productId);
        if (!product) return res.status(404).json({ message: 'Product niet gevonden.' });

        const orderId = 'OAL-' + Date.now();
        const order = new Order({
            orderId,
            type: 'oa-logica',
            producten: [{ item: product.naam, quantity, opmerking: `${integratie}${opmerking ? ' — ' + opmerking : ''}` }]
        });
        await order.save();
        sendNewOrderNotification(order);

        // ✉️ Klantmail
        await sendBrevoEmail({
            to: email,
            subject: `Bevestiging bestelling OA Logica – ${orderId}`,
            html: `
                <h2>Bedankt voor je bestelling, ${naam}!</h2>
                <p>Je hebt ${quantity}x <strong>${product.naam}</strong> besteld.</p>
                <p><strong>Integratie:</strong> ${integratie}</p>
                <p><strong>Opmerking:</strong> ${opmerking || '-'}</p>
                <hr><p>We nemen spoedig contact met je op.<br>Met vriendelijke groet,<br><strong>OA Logica</strong></p>
            `
        });

        // ✉️ Adminmail
        await sendBrevoEmail({
            to: 'info@oalogica.nl',
            subject: `📥 Nieuwe bestelling (${orderId}) van ${naam}`,
            html: `
                <h2>Nieuwe bestelling geplaatst</h2>
                <p><strong>Naam:</strong> ${naam}</p>
                <p><strong>E-mail:</strong> ${email}</p>
                <p><strong>Telefoon:</strong> ${telefoon}</p>
                <p><strong>Product:</strong> ${product.naam}</p>
                <p><strong>Aantal:</strong> ${quantity}</p>
                <p><strong>Integratie:</strong> ${integratie}</p>
                <p><strong>Opmerking:</strong> ${opmerking || '-'}</p>
                <p><strong>Order ID:</strong> ${orderId}</p>
            `
        });

        res.json({ message: '✅ Bestelling geplaatst!', order });
    } catch (err) {
        console.error('Fout bij OA Logica bestelling:', err);
        res.status(500).json({ message: '⛔ Fout bij OA Logica bestelling.' });
    }
});

// 🔄 Status update
app.patch('/admin/order/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ message: '⛔ Status is verplicht.' });

    try {
        const order = await Order.findOneAndUpdate({ orderId }, { status }, { new: true });
        if (!order) return res.status(404).json({ message: '❌ Bestelling niet gevonden.' });
        res.json({ message: '✅ Status bijgewerkt', status: order.status });
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij updaten status.' });
    }
});

// Stripe
app.post('/connection_token', async (req, res) => {
    try {
        const token = await stripe.terminal.connectionTokens.create();
        res.json({ secret: token.secret });
    } catch {
        res.status(500).json({ error: 'Kon connection token niet aanmaken' });
    }
});

// Admin overzicht
app.get('/admin', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        let html = `<h2>Overzicht Bestellingen</h2><table border="1"><tr>
            <th>Order ID</th><th>Type</th><th>Kiosk</th><th>Item</th><th>Aantal</th>
            <th>Opmerking</th><th>Tijd</th><th>Status</th></tr>`;
        orders.forEach(order => {
            order.producten.forEach(p => {
                html += `<tr><td>${order.orderId}</td><td>${order.type}</td><td>${order.kiosk}</td>
                    <td>${p.item}</td><td>${p.quantity}</td><td>${p.opmerking || ''}</td>
                    <td>${new Date(order.createdAt).toLocaleString()}</td><td>${order.status}</td></tr>`;
            });
        });
        html += '</table>';
        res.send(html);
    } catch {
        res.status(500).send('⛔ Fout bij ophalen bestellingen.');
    }
});

// PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
    const { amount } = req.body;
    if (!amount || isNaN(amount)) return res.status(400).json({ message: '⛔ Ongeldig bedrag.' });

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'usd',
            payment_method_types: ['card']
        });
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch {
        res.status(500).json({ message: '⛔ Fout bij aanmaken PaymentIntent.' });
    }
});

// 🟢 Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server actief op poort ${PORT}`));
