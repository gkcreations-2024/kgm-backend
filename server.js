const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require("fs");
const nodemailer = require("nodemailer");
const path = require("path");
require("dotenv").config();

const app = express();

// ✅ Middleware
app.use(cors());
app.use(bodyParser.json());

// ✅ MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.once("open", () => console.log("✅ MongoDB Connected"));
db.on("error", (err) => console.log("❌ DB Error:", err));

// ✅ Schemas
const OrderSchema = new mongoose.Schema({
  orderId: { type: Number, unique: true },
  customer: {
    name: String,
    email: String,
    phone: String,
    pincode: String,
    address: String,
  },
  products: [
    {
      name: String,
      price: Number,
      qty: Number,
    },
  ],
  date: { type: Date, default: Date.now },
});

const CounterSchema = new mongoose.Schema({
  name: String,
  seq: Number,
});

const Order = mongoose.model("Order", OrderSchema);
const Counter = mongoose.model("Counter", CounterSchema);

// ✅ Order Counter Generator
async function getNextOrderId() {
  const counter = await Counter.findOneAndUpdate(
    { name: "orderId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

// ✅ Default route
app.get("/", (req, res) => {
  res.send("🔥 KGM Cracker Ordering Server is Live!");
});

// ✅ Checkout Route
app.post("/api/checkout", async (req, res) => {
  try {
    const { customer, products } = req.body;

    const orderId = await getNextOrderId();
    const order = new Order({ orderId, customer, products });
    await order.save();

    const pdfPath = `invoice_${orderId}.pdf`;

    await generatePDFInvoice(order, pdfPath);
    await sendInvoiceEmail(customer.email, pdfPath, orderId);

    res.json({ success: true });

    // Delete file after 60s
    setTimeout(() => {
      fs.unlink(pdfPath, () => {});
    }, 60000);
  } catch (err) {
    console.error("❌ Error in checkout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function generatePDFInvoice(order, filePath) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;

  const lineHeight = 20;
  const tableHeaderHeight = 25;
  const rowHeight = 18;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text, x, y, options = {}) => {
    page.drawText(text, {
      x,
      y,
      size: options.size || 10,
      font: options.font || font,
      color: options.color || rgb(0, 0, 0),
      ...options,
    });
  };

  const drawLine = (y) => {
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 0.5,
      color: rgb(0.2, 0.2, 0.2),
    });
  };

  const addPageIfNeeded = () => {
    if (y < margin + 80) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawTableHeader();
      y -= rowHeight;
    }
  };

  const drawTableHeader = () => {
    drawText("S.No", margin, y, { font: boldFont });
    drawText("Description", margin + 40, y, { font: boldFont });
    drawText("Qty", margin + 280, y, { font: boldFont });
    drawText("Price (₹)", margin + 340, y, { font: boldFont });
    drawText("Total (₹)", margin + 430, y, { font: boldFont });
    drawLine(y - 2);
  };

  // Header
  drawText("INVOICE", margin, y, { font: boldFont, size: 20 });
  y -= lineHeight * 2;

  // Customer Info
  drawText("Bill To:", margin, y, { font: boldFont });
  y -= lineHeight;
  drawText(order.customer.name, margin, y);
  y -= lineHeight;
  drawText(order.customer.phone, margin, y);
  y -= lineHeight;
  drawText(order.customer.address, margin, y);
  y -= lineHeight;
  drawText(`Pincode: ${order.customer.pincode}`, margin, y);

  y += lineHeight * 4;
  drawText("From:", pageWidth / 2, y, { font: boldFont });
  y -= lineHeight;
  drawText("KGM Crackers", pageWidth / 2, y);
  y -= lineHeight;
  drawText("7904303676", pageWidth / 2, y);
  y -= lineHeight;
  drawText("6/7491-A, Samy Puram Colony, Sivakasi", pageWidth / 2, y);

  y -= lineHeight;
  drawText(`Date: ${new Date(order.date).toLocaleDateString("en-IN")}`, margin, y);
  drawText(`Invoice No: INV-${order.orderId}`, pageWidth / 2, y);

  y -= lineHeight * 2;

  // Table
  drawTableHeader();
  y -= rowHeight;

  let totalAmount = 0;

  for (let i = 0; i < order.products.length; i++) {
    const item = order.products[i];
    const amount = item.qty * item.price;
    totalAmount += amount;

    addPageIfNeeded();

    drawText((i + 1).toString(), margin, y);
    drawText(item.name, margin + 40, y);
    drawText(item.qty.toString(), margin + 290, y);
    drawText(item.price.toFixed(2), margin + 350, y);
    drawText(amount.toFixed(2), margin + 440, y);

    y -= rowHeight;
  }

  // Subtotal
  y -= rowHeight;
  drawLine(y + rowHeight / 2);
  drawText("Subtotal", margin + 340, y, { font: boldFont });
  drawText(`₹${totalAmount.toFixed(2)}`, margin + 440, y, { font: boldFont });

  y -= lineHeight * 3;
  drawText("Authorized Signature", pageWidth - 180, y, { font: boldFont });

  // Write PDF
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, pdfBytes);
}
// ✅ Email Function
function sendInvoiceEmail(toEmail, pdfPath, orderId) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `KGM Crackers <${process.env.EMAIL_USER}>`,
      to: toEmail,
      bcc: "kgmcrackers2025@gmail.com",
      subject: `🧨 Your Invoice - KGM Crackers Order #${orderId}`,
      text: `Dear Customer,\n\nThank you for your order!\nPlease find the attached invoice for your order #${orderId}.\n\nRegards,\nKGM Crackers Team`,
      attachments: [{ filename: `invoice_${orderId}.pdf`, path: pdfPath }],
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error("❌ Email error:", err);
        reject(err);
      } else {
        console.log("✅ Email sent:", info.response);
        resolve();
      }
    });
  });
}

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
