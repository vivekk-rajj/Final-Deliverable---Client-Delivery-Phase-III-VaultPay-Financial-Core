const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');
const Stripe = require('stripe');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vaultpay-dev-secret';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2024-06-20'
});

const users = [
  {
    id: 'user-admin',
    name: 'Nexus Admin',
    email: 'admin@nexusservices.com',
    password: 'Admin@123',
    role: 'admin'
  },
  {
    id: 'user-client-123',
    name: 'Evelyn McArthur',
    email: 'evelyn@acmepartners.com',
    password: 'Client@123',
    role: 'client'
  },
  {
    id: 'user-client-456',
    name: 'Aoi Tanaka',
    email: 'aoi@northstar-consulting.com',
    password: 'Client@123',
    role: 'client'
  }
];

const invoices = [
  {
    id: 'inv_1001',
    number: 'INV-1001',
    clientId: 'user-client-123',
    clientName: 'Evelyn McArthur',
    clientEmail: 'evelyn@acmepartners.com',
    description: 'Strategic Advisory Retainer',
    amount: 12500,
    currency: 'USD',
    dueDate: '2026-11-18',
    status: 'Unpaid'
  },
  {
    id: 'inv_1002',
    number: 'INV-1002',
    clientId: 'user-client-456',
    clientName: 'Aoi Tanaka',
    clientEmail: 'aoi@northstar-consulting.com',
    description: 'Corporate Compliance Review',
    amount: 8500,
    currency: 'USD',
    dueDate: '2026-11-25',
    status: 'Paid'
  },
  {
    id: 'inv_1003',
    number: 'INV-1003',
    clientId: 'user-client-123',
    clientName: 'Evelyn McArthur',
    clientEmail: 'evelyn@acmepartners.com',
    description: 'Change Management Sprint',
    amount: 6400,
    currency: 'USD',
    dueDate: '2026-12-02',
    status: 'Pending'
  }
];

const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users.find((entry) => entry.id === payload.sub);

    if (!user) {
      return res.status(401).json({ message: 'Invalid auth token.' });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions.' });
    }
    return next();
  };
}

function findInvoiceById(id) {
  return invoices.find((invoice) => invoice.id === id);
}

function assertInvoiceOwnership(req, res, next) {
  const invoice = findInvoiceById(req.params.id);

  if (!invoice) {
    return res.status(404).json({ message: 'Invoice not found.' });
  }

  if (req.user.role === 'client' && invoice.clientId !== req.user.id) {
    return res.status(403).json({ message: 'Forbidden: invoice does not belong to this client.' });
  }

  req.invoice = invoice;
  return next();
}

function createInvoicePdf(invoice, user) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(24).text('Nexus Corporate Services', { align: 'left' });
    doc.moveDown();
    doc.fontSize(12).text('Client Billing Portal', { align: 'left' });
    doc.moveDown();
    doc.fontSize(18).text('Invoice Receipt', { align: 'center' });
    doc.moveDown();

    doc.moveDown();
    doc.fontSize(12).text(`Invoice #: ${invoice.number}`);
    doc.text(`Client: ${invoice.clientName}`);
    doc.text(`Email: ${user.email}`);
    doc.text(`Due Date: ${invoice.dueDate}`);
    doc.text(`Status: ${invoice.status}`);
    doc.moveDown();

    doc.text(`Description: ${invoice.description}`);
    doc.text(`Amount: ${invoice.currency} ${invoice.amount.toLocaleString()}`);

    if (invoice.status === 'Paid') {
      doc.rotate(45, { origin: [300, 250] });
      doc.fillColor('red').fontSize(42).text('PAID', { align: 'center' });
      doc.rotate(-45, { origin: [300, 250] });
    }

    doc.end();
  });
}

async function sendReceiptEmail(user, invoice, pdfBuffer) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const mailOptions = {
    from: process.env.SMTP_USER || 'noreply@nexusservices.com',
    to: user.email,
    subject: `Receipt for ${invoice.number}`,
    text: `Hello ${user.name}, your invoice ${invoice.number} has been paid successfully.`,
    attachments: [
      {
        filename: `${invoice.number}.pdf`,
        content: pdfBuffer
      }
    ]
  };

  await transporter.sendMail(mailOptions);
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    return res.status(500).json({ message: 'Webhook secret missing.' });
  }

  let event;

  try {
    event = Stripe.webhooks.constructEvent(req.body, signature, endpointSecret);
  } catch (error) {
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId = session.metadata?.invoiceId;
    const foundInvoice = findInvoiceById(invoiceId);

    if (foundInvoice) {
      foundInvoice.status = 'Paid';
      const clientUser = users.find((user) => user.id === foundInvoice.clientId);
      if (clientUser) {
        const pdfBuffer = await createInvoicePdf(foundInvoice, clientUser);
        await sendReceiptEmail(clientUser, foundInvoice, pdfBuffer);
      }
    }
  }

  return res.json({ received: true });
});

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'VaultPay Financial Core' });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const matchingUser = users.find((user) => user.email.toLowerCase() === String(email || '').toLowerCase() && user.password === String(password || ''));

  if (!matchingUser) {
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  return res.json({
    token: signToken(matchingUser),
    user: sanitizeUser(matchingUser)
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/admin/overview', requireAuth, requireRole('admin'), (req, res) => {
  const totalRevenue = invoices
    .filter((invoice) => invoice.status === 'Paid')
    .reduce((sum, invoice) => sum + invoice.amount, 0);

  const clientCount = new Set(invoices.map((invoice) => invoice.clientId)).size;

  res.json({
    totalRevenue,
    clientCount,
    invoiceCount: invoices.length,
    invoices
  });
});

app.get('/api/admin/clients', requireAuth, requireRole('admin'), (req, res) => {
  const payload = users
    .filter((user) => user.role === 'client')
    .map((user) => ({
      ...sanitizeUser(user),
      invoices: invoices.filter((invoice) => invoice.clientId === user.id)
    }));

  res.json(payload);
});

app.post('/api/admin/invoices', requireAuth, requireRole('admin'), (req, res) => {
  const { clientId, amount, description, dueDate } = req.body || {};

  if (!clientId || !amount || !description || !dueDate) {
    return res.status(400).json({ message: 'clientId, amount, description, and dueDate are required.' });
  }

  const client = users.find((user) => user.id === clientId && user.role === 'client');
  if (!client) {
    return res.status(404).json({ message: 'Client not found.' });
  }

  const newInvoice = {
    id: `inv_${Date.now()}`,
    number: `INV-${Date.now()}`,
    clientId,
    clientName: client.name,
    clientEmail: client.email,
    description,
    amount: Number(amount),
    currency: 'USD',
    dueDate,
    status: 'Unpaid'
  };

  invoices.push(newInvoice);

  return res.status(201).json(newInvoice);
});

app.get('/api/invoices', requireAuth, (req, res) => {
  if (req.user.role === 'admin') {
    return res.json(invoices);
  }

  const filteredInvoices = invoices.filter((invoice) => invoice.clientId === req.user.id);
  return res.json(filteredInvoices);
});

app.get('/api/invoices/:id', requireAuth, assertInvoiceOwnership, (req, res) => {
  res.json({ invoice: req.invoice });
});

app.get('/api/invoices/:id/pdf', requireAuth, assertInvoiceOwnership, async (req, res) => {
  const pdfBuffer = await createInvoicePdf(req.invoice, req.user);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${req.invoice.number}.pdf"`);
  return res.send(pdfBuffer);
});

app.post('/api/invoices/:id/pay', requireAuth, assertInvoiceOwnership, async (req, res) => {
  if (req.user.role !== 'client') {
    return res.status(403).json({ message: 'Only clients can pay invoices.' });
  }

  const invoice = req.invoice;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: invoice.description,
          metadata: {
            invoiceId: invoice.id
          }
        },
        unit_amount: Math.round(invoice.amount * 100)
      },
      quantity: 1
    }],
    metadata: {
      invoiceId: invoice.id,
      clientId: req.user.id
    },
    customer_email: req.user.email,
    success_url: `${process.env.APP_URL || 'http://localhost:3000'}/client/dashboard?payment=success`,
    cancel_url: `${process.env.APP_URL || 'http://localhost:3000'}/client/dashboard?payment=cancelled`
  });

  return res.json({ sessionUrl: session.url, invoiceId: invoice.id });
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/client/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

app.get('/forbidden', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forbidden.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`VaultPay server listening on http://localhost:${PORT}`);
});
