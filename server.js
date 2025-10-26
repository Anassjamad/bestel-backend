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
    'https://www.oalogica.nl',
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
    image: { type: String, default: '' },
    type: { type: String, enum: ['qr', 'kiosk', 'maatwerk'], required: true },
    features: [{ type: String }],
    requiresIntegration: { type: Boolean, default: true }
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
    const { naam, image, type, features, requiresIntegration } = req.body;
    if (!naam || !type) return res.status(400).json({ message: 'Naam en type zijn verplicht.' });

    try {
        const product = new OALogicaProduct({
            naam,
            image: image || '',
            type,
            features: features || [],
            requiresIntegration: requiresIntegration !== undefined ? requiresIntegration : true
        });
        await product.save();
        res.json({ message: '✅ Product toegevoegd!', product });
    } catch (err) {
        console.error('Fout bij toevoegen product:', err);
        res.status(500).json({ message: '⛔ Fout bij toevoegen product.' });
    }
});

app.delete('/oa-logica/products/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const product = await OALogicaProduct.findByIdAndDelete(id);
        if (!product) return res.status(404).json({ message: 'Product niet gevonden.' });
        res.json({ message: '✅ Product verwijderd!', product });
    } catch (err) {
        console.error('Fout bij verwijderen product:', err);
        res.status(500).json({ message: '⛔ Fout bij verwijderen product.' });
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
    const { naam, bedrijf, email, telefoon, productId, integrationType, kassaOptie, supportType } = req.body;
    if (!naam || !bedrijf || !email || !productId)
        return res.status(400).json({ message: 'Naam, bedrijfsnaam, email en product zijn verplicht.' });

    try {
        const product = await OALogicaProduct.findById(productId);
        if (!product) return res.status(404).json({ message: 'Product niet gevonden.' });

        const orderId = 'OAL-' + Date.now();
        const order = new Order({
            orderId,
            type: 'oa-logica',
            producten: [{
                item: product.naam, quantity: 1,

                opmerking: `Integratie: ${integrationType || '-'}, Kassa: ${kassaOptie || '-'}, Support: ${supportType || '-'}`
            }]
        });
        await order.save();
        sendNewOrderNotification(order);

        const htmlClient = `
         <div style="font-family:Inter,sans-serif;color:#e6eef8;background:#0a0f1f;padding:32px;border-radius:16px;max-width:600px;margin:auto;">
    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
        <h1 style="margin:0;font-size:2rem;background:linear-gradient(90deg,#2563eb,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700;">
            Bedankt voor je bestelling, ${naam}!
        </h1>
        <p style="margin:8px 0 0;color:#94a3b8;">Hieronder vind je de details van jouw bestelling bij OA Logica</p>
    </div>

    <!-- Product Info -->
    <div style="background:#1a2236;padding:20px;border-radius:12px;margin-bottom:24px;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
        <h2 style="margin:0 0 12px;font-size:1.2rem;color:#7c3aed;">Productinformatie</h2>
        <p style="margin:4px 0;"><strong>Product:</strong> ${product.naam}</p>
        <p style="margin:4px 0;"><strong>Integratie:</strong> ${integrationType || '-'}</p>
        <p style="margin:4px 0;"><strong>Kassa:</strong> ${kassaOptie || '-'}</p>
        <p style="margin:4px 0;"><strong>Support:</strong> ${supportType || '-'}</p>
    </div>

    <!-- Klant Info -->
    <div style="background:#1a2236;padding:20px;border-radius:12px;margin-bottom:24px;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
        <h2 style="margin:0 0 12px;font-size:1.2rem;color:#2563eb;">Jouw gegevens</h2>
        <p style="margin:4px 0;"><strong>Bedrijf:</strong> ${bedrijf}</p>
        <p style="margin:4px 0;"><strong>Telefoon:</strong> ${telefoon || '-'}</p>
        <p style="margin:4px 0;"><strong>Email:</strong> ${email}</p>
    </div>

    <!-- Call to Action -->
    <div style="text-align:center;margin-bottom:32px;">
        <a href="https://oalogica-site.vercel.app/contact.html" style="display:inline-block;padding:14px 24px;border-radius:12px;background:linear-gradient(90deg,#2563eb,#7c3aed);color:white;font-weight:600;text-decoration:none;box-shadow:0 0 12px rgba(37,99,235,0.5);transition:all 0.3s;">Neem contact op</a>
    </div>

    <!-- Footer -->
    <hr style="border:none;border-top:1px solid #2c3e50;margin:32px 0;">
    <p style="font-size:0.85rem;color:#94a3b8;text-align:center;margin:0;">
        OA Logica — Ontwikkelend & Automatiserend<br>
        <strong>Email:</strong> info@oalogica.nl | <strong>Tel:</strong> +31 123 456 789
    </p>
    <p style="font-size:0.75rem;color:#555;text-align:center;margin-top:4px;">
        &copy; 2025 OA Logica. Alle rechten voorbehouden.
    </p>
</div>
        `;
        await sendBrevoEmail({ to: email, subject: `Bevestiging bestelling OA Logica – ${orderId}`, html: htmlClient });

        const htmlAdmin = `
            <div style="font-family:Inter,sans-serif;color:#e6eef8;background:#0a0f1f;padding:24px;border-radius:16px;">
                <h2>Nieuwe bestelling geplaatst</h2>
                <p>Order ID: <strong>${orderId}</strong></p>
                <p>Naam: <strong>${naam}</strong></p>
                <p>Bedrijf: <strong>${bedrijf}</strong></p>
                <p>Email: <strong>${email}</strong></p>
                <p>Telefoon: <strong>${telefoon || '-'}</strong></p>
                <p>Product: <strong>${product.naam}</strong></p>
                <p>Integratie: <strong>${integrationType || '-'}</strong></p>
                <p>Kassa: <strong>${kassaOptie || '-'}</strong></p>
                <p>Support: <strong>${supportType || '-'}</strong></p>
            </div>
        `;
        await sendBrevoEmail({ to: 'info@oalogica.nl', subject: `📥 Nieuwe bestelling (${orderId}) van ${naam}`, html: htmlAdmin });

        res.json({ message: '✅ Bestelling geplaatst!', order });
    } catch (err) {
        console.error('Fout bij bestelling:', err);
        res.status(500).json({ message: '⛔ Fout bij bestelling.' });
    }
});


// 🟢 Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server actief op poort ${PORT}`));

app.post('/connection_token', async (req, res) => {
    try {
        const token = await stripe.terminal.connectionTokens.create();
        res.json({ secret: token.secret });
    } catch (error) {
        console.error('Fout bij aanmaken connection token:', error);
        res.status(500).json({ error: 'Kon connection token niet aanmaken' });
    }
});