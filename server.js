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

// 🧪 Test route om e-mail te controleren
app.get('/test-email', async (req, res) => {
    const to = req.query.to;
    if (!to) return res.status(400).json({ message: 'Voeg een ?to=<emailadres> toe aan de URL.' });

    try {
        await sendBrevoEmail({
            to,
            subject: '✅ Testmail van OA Logica via Brevo',
            html: `
                <h2>Hallo!</h2>
                <p>Als je dit bericht ontvangt, werkt je Brevo-integratie correct 🎉</p>
                <hr>
                <p>Verzonden via: <strong>Render + Brevo API</strong></p>
            `
        });
        res.json({ message: `✅ Testmail verzonden naar ${to}` });
    } catch (err) {
        console.error('Test e-mail fout:', err);
        res.status(500).json({ message: '⛔ Fout bij verzenden testmail.' });
    }
});

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

app.post('/oa-logica/order', async (req, res) => {
    const { naam, email, telefoon, bedrijfsnaam, productId, quantity } = req.body;

    if (!naam || !email || !productId)
        return res.status(400).json({ message: 'Naam, email en product zijn verplicht.' });

    try {
        const product = await OALogicaProduct.findById(productId);
        if (!product) return res.status(404).json({ message: 'Product niet gevonden.' });

        const orderId = 'OAL-' + Date.now();
        const order = new Order({
            orderId,
            type: 'oa-logica',
            producten: [{
                item: product.naam,
                quantity: quantity || 1,
                opmerking: bedrijfsnaam || '-'
            }]
        });
        await order.save();
        sendNewOrderNotification(order);

        // ✉️ Klantmail
        await sendBrevoEmail({
            to: email,
            subject: `Bevestiging aanvraag OA Logica – ${orderId}`,
            html: `
                <div style="font-family:Inter,sans-serif;background:#0f172a;color:#e6eef8;padding:20px;border-radius:12px;">
                    <h2 style="color:#2563eb;">Bedankt voor je aanvraag, ${naam}!</h2>
                    <p>Je hebt een aanvraag gedaan voor <strong>${product.naam}</strong>.</p>
                    <p><strong>Bedrijfsnaam:</strong> ${bedrijfsnaam || '-'}</p>
                    <p><strong>Aantal:</strong> ${quantity || 1}</p>
                    <hr style="border:0;border-top:1px solid #2563eb;margin:12px 0;">
                    <p>We nemen spoedig contact met je op.<br><strong>OA Logica</strong></p>
                </div>
            `
        });

        // ✉️ Adminmail
        await sendBrevoEmail({
            to: 'info@oalogica.nl',
            subject: `📥 Nieuwe aanvraag (${orderId}) van ${naam}`,
            html: `
                <div style="font-family:Inter,sans-serif;background:#0f172a;color:#e6eef8;padding:20px;border-radius:12px;">
                    <h2 style="color:#7c3aed;">Nieuwe aanvraag ontvangen</h2>
                    <p><strong>Naam:</strong> ${naam}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Telefoon:</strong> ${telefoon || '-'}</p>
                    <p><strong>Bedrijfsnaam:</strong> ${bedrijfsnaam || '-'}</p>
                    <p><strong>Product:</strong> ${product.naam}</p>
                    <p><strong>Aantal:</strong> ${quantity || 1}</p>
                    <p><strong>Order ID:</strong> ${orderId}</p>
                </div>
            `
        });

        res.json({ message: '✅ Aanvraag geplaatst!', order });
    } catch (err) {
        console.error('Fout bij OA Logica bestelling:', err);
        res.status(500).json({ message: '⛔ Fout bij OA Logica bestelling.' });
    }
});

// 🟢 Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server actief op poort ${PORT}`));
