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
function splitText(text, maxLen) {
  const lines = [];
  while (text.length > maxLen) {
    let splitAt = text.lastIndexOf(' ', maxLen);
    if (splitAt === -1) splitAt = maxLen;
    lines.push(text.substring(0, splitAt));
    text = text.substring(splitAt).trim();
  }
  lines.push(text);
  return lines;
}
function drawBoxedText(page, text, x, y, width, height, font, fontSize = 10) {
  page.drawRectangle({
    x, y: y - height,
    width, height,
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 1,
  });

  const lines = splitText(text, 40);
  let offsetY = y - fontSize - 4;
  for (const line of lines) {
    page.drawText(line, {
      x: x + 5,
      y: offsetY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
    offsetY -= fontSize + 2;
  }
}

async function generatePDFInvoice(order, filePath) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'));
  const font = await pdfDoc.embedFont(fontBytes);
  const boldFont = font;

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const lineHeight = 20;
  const rowHeight = 24;

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
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
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
    const headers = ['S.No', 'Description', 'Qty', 'Price (₹)', 'Total (₹)'];
    const positions = [margin, margin + 40, margin + 280, margin + 340, margin + 430];
    const widths = [40, 240, 60, 90, 90];
    const headerHeight = rowHeight;

    for (let i = 0; i < headers.length; i++) {
      page.drawRectangle({
        x: positions[i],
        y: y - headerHeight,
        width: widths[i],
        height: headerHeight,
        color: rgb(0.09, 0.27, 0.47),
        borderWidth: 1,
        borderColor: rgb(0.2, 0.2, 0.2),
      });
      drawText(headers[i], positions[i] + 4, y - 8, { font: boldFont, color: rgb(1, 1, 1) });
    }
    y -= headerHeight;
  };

  // Title
  drawText('INVOICE', pageWidth / 2 - 30, y, { font: boldFont, size: 18 });
  y -= lineHeight * 2;

  // Boxed Billing Info
  const boxHeight = 80;
  const leftBoxY = y;
  const boxWidth = (pageWidth - 2 * margin - 20) / 2;
  const leftX = margin;
  const rightX = leftX + boxWidth + 20;

  const leftAddress = [
    `Bill To:`,
    `${order.customer.name}`,
    `${order.customer.phone}`,
    ...splitText(order.customer.address, 45),
    `Pincode: ${order.customer.pincode}`,
    `Date: ${new Date(order.date).toLocaleDateString('en-IN')}`,
  ].join('\n');

  const rightAddress = [
    `From:`,
    `K.G.M. TRADERS`,
    `+91 86678 48501`,
    ...splitText('3/1320-14,R.R.NAGAR,PARAIPATTI,SIVAKASI', 45),
    `Pincode: 626189`,
    `Invoice No: INV-${order.orderId}`,
  ].join('\n');

  drawBoxedText(page, leftAddress, leftX, y, boxWidth, boxHeight, font);
  drawBoxedText(page, rightAddress, rightX, y, boxWidth, boxHeight, font);
  y -= boxHeight + 10;

  drawTableHeader();

  let totalAmount = 0;
  for (let i = 0; i < order.products.length; i++) {
    const item = order.products[i];
    const amount = item.qty * item.price;
    totalAmount += amount;
    addPageIfNeeded();

    const values = [
      (i + 1).toString(),
      item.name,
      item.qty.toString(),
      item.price.toFixed(2),
      amount.toFixed(2),
    ];

    const positions = [margin, margin + 40, margin + 280, margin + 340, margin + 430];
    const widths = [40, 240, 60, 90, 90];

    for (let j = 0; j < values.length; j++) {
      page.drawRectangle({
        x: positions[j],
        y: y - rowHeight,
        width: widths[j],
        height: rowHeight,
        borderWidth: 1,
        borderColor: rgb(0.8, 0.8, 0.8),
      });
      drawText(values[j], positions[j] + 4, y - 8);
    }

    y -= rowHeight;
  }

  // Subtotal Box
  y -= 10;
  drawLine(y + rowHeight / 2);
  page.drawRectangle({
    x: margin + 340,
    y: y - rowHeight,
    width: 180,
    height: rowHeight,
    borderWidth: 1,
    borderColor: rgb(0.8, 0.8, 0.8),
  });
  drawText('Subtotal', margin + 345, y - 8, { font: boldFont });
  drawText(`₹${totalAmount.toFixed(2)}`, margin + 430, y - 8, { font: boldFont });

  y -= lineHeight * 3;
  drawText('Authorized Signature', pageWidth - 180, y, { font: boldFont });

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
