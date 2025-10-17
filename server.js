const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false, // false voor poort 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false // Nodig voor One.com om fouten te voorkomen
    }
});

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
    'https://js.stripe.com/terminal/v1/terminal.mjs',
    'https://adminoa.vercel.app',
    'https://oalogica-site.vercel.app' // OA Logica frontend toegevoegd
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
    type: { type: String, enum: ['takeaway', 'pickup', 'oa-logica'], required: true },
    kiosk: { type: Number, default: 0 }, // kiosk op bestelling-niveau
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

// OA Logica Product model
const OALogicaProduct = mongoose.model('OALogicaProduct', new mongoose.Schema({
    naam: { type: String, required: true },
    prijs: { type: Number, required: true },
    image: { type: String, default: '' },
    type: { type: String, enum: ['qr', 'kiosk', 'maatwerk'], required: true },
    features: [{ type: String }]
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

// ✅ Producten ophalen (origineel)
app.get('/products', async (req, res) => {
    try {
        const producten = await Product.find();
        res.json(producten);
    } catch (err) {
        res.status(500).json({ message: '⛔ Fout bij ophalen van producten.' });
    }
});

// 📌 OA Logica product toevoegen (POST)
app.post('/oa-logica/products', async (req, res) => {
    const { naam, prijs, image, type, features } = req.body;

    if (!naam || !prijs || !type) {
        return res.status(400).json({ message: 'Naam, prijs en type zijn verplicht.' });
    }

    try {
        const product = new OALogicaProduct({
            naam,
            prijs,
            image: image || '',
            type,
            features: features || []
        });

        await product.save();
        res.json({ message: '✅ Product toegevoegd!', product });
    } catch (err) {
        console.error('Fout bij toevoegen product:', err);
        res.status(500).json({ message: '⛔ Fout bij toevoegen product.', error: err.message });
    }
});

// ✅ OA Logica producten ophalen
app.get('/oa-logica/products', async (req, res) => {
    try {
        const producten = await OALogicaProduct.find();
        res.json(producten);
    } catch (err) {
        console.error('Fout bij ophalen OA Logica producten:', err);
        res.status(500).json({ message: '⛔ Fout bij ophalen OA Logica producten.' });
    }
});

// 📬 Bestelling plaatsen (origineel)
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

async function sendOrderConfirmationEmail({ to, subject, html }) {
    try {
        await transporter.sendMail({
            from: `"OA Logica" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ E-mail verzonden naar ${to}`);
    } catch (err) {
        console.error('⛔ Fout bij verzenden van e-mail:', err);
    }
}


// 📬 OA Logica bestelling plaatsen
app.post('/oa-logica/order', async (req, res) => {
    const { naam, email, telefoon, productId, quantity, integratie, opmerking } = req.body;

    if (!naam || !email || !productId || !quantity || !integratie) {
        return res.status(400).json({ message: 'Naam, email, product, aantal en integratie zijn verplicht.' });
    }

    try {
        const product = await OALogicaProduct.findById(productId);
        if (!product) return res.status(404).json({ message: 'Product niet gevonden.' });

        const orderId = 'OAL-' + Date.now();

        const order = new Order({
            orderId,
            type: 'oa-logica',
            producten: [{
                item: product.naam,
                quantity: quantity,
                opmerking: `${integratie}${opmerking ? ' — ' + opmerking : ''}`
            }],
            createdAt: new Date()
        });

        await order.save();
        sendNewOrderNotification(order);

        // ✉️ Bevestigingsmail naar klant
        const klantMail = `
            <h2>Bedankt voor je bestelling, ${naam}!</h2>
            <p>Je hebt ${quantity}x <strong>${product.naam}</strong> besteld.</p>
            <p><strong>Integratie:</strong> ${integratie}</p>
            <p><strong>Opmerking:</strong> ${opmerking || '-'}</p>
            <p>We nemen spoedig contact met je op.</p>
            <hr>
            <p>Met vriendelijke groet,<br>OA Logica</p>
        `;

        await sendOrderConfirmationEmail({
            to: email,
            subject: `Bevestiging bestelling OA Logica – ${orderId}`,
            html: klantMail
        });

        // ✉️ Kopie naar jouw e-mailadres
        const adminMail = `
            <h2>Nieuwe bestelling geplaatst</h2>
            <p><strong>Naam:</strong> ${naam}</p>
            <p><strong>E-mail:</strong> ${email}</p>
            <p><strong>Telefoon:</strong> ${telefoon}</p>
            <p><strong>Product:</strong> ${product.naam}</p>
            <p><strong>Aantal:</strong> ${quantity}</p>
            <p><strong>Integratie:</strong> ${integratie}</p>
            <p><strong>Opmerking:</strong> ${opmerking || '-'}</p>
            <p><strong>Order ID:</strong> ${orderId}</p>
        `;

        await sendOrderConfirmationEmail({
            to: 'info@oalogica.nl',
            subject: `📥 Nieuwe bestelling (${orderId}) van ${naam}`,
            html: adminMail
        });

        res.json({ message: '✅ Bestelling geplaatst!', order });

    } catch (err) {
        console.error('Fout bij OA Logica bestelling:', err);
        res.status(500).json({ message: '⛔ Fout bij OA Logica bestelling.', error: err.message });
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

// connection_token (stripe)
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

// 📦 Betaling Intent aanmaken (stripe)
app.post('/create-payment-intent', async (req, res) => {
    const { amount } = req.body;

    if (!amount || isNaN(amount)) {
        return res.status(400).json({ message: '⛔ Ongeldig bedrag.' });
    }

    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: 'usd',
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
