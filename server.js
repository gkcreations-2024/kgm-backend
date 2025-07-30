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

async function generatePDFInvoice(order, filePath) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'));
  const font = await pdfDoc.embedFont(fontBytes);
  const boldFont = font;

  // Constants
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;
  const lineHeight = 18;
  const rowHeight = 24;
  const textPadding = 4;
  const columnPositions = [margin, margin + 60, margin + 270, margin + 400, margin + 480];
  const columnWidths = [40, 200, 60, 60, 80];

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

  const drawCenteredText = (text, x, width, y, options = {}) => {
    const textWidth = font.widthOfTextAtSize(text, options.size || 10);
    drawText(text, x + (width - textWidth) / 2, y, options);
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
    const headers = ['S.No', 'Description', 'Qty', 'Price', 'Total'];
    const headerHeight = rowHeight;

    for (let i = 0; i < headers.length; i++) {
      page.drawRectangle({
        x: columnPositions[i],
        y: y - headerHeight,
        width: columnWidths[i],
        height: headerHeight,
        color: rgb(0.09, 0.27, 0.47),
        borderWidth: 1,
        borderColor: rgb(0.2, 0.2, 0.2),
      });
      drawCenteredText(
        headers[i],
        columnPositions[i],
        columnWidths[i],
        y - (headerHeight / 2) - 5,
        { font: boldFont, color: rgb(1, 1, 1) }
      );
    }
    y -= headerHeight;
  };

  // Title
  drawText('INVOICE', pageWidth / 2 - 30, y, { font: boldFont, size: 24 });
  y -= lineHeight * 3;

  // Billing Info Columns
  const colWidth = (pageWidth - 2 * margin - 20) / 2;
  const leftX = margin;
  const rightX = leftX + colWidth + 20;

  // Left Column (Bill To)
  drawText('Bill To:', leftX, y, { font: boldFont });
  y -= lineHeight;
  
  const addressLines = splitText(order.customer.address, 35);
  const customerLines = [
    `${order.customer.name}`,
    `${order.customer.phone}`,
    ...addressLines,
    `Pincode: ${order.customer.pincode}`
  ];
  
  customerLines.forEach(line => {
    drawText(line, leftX, y);
    y -= lineHeight;
  });

  // Right Column (From)
  const initialY = y + (customerLines.length + 1) * lineHeight;
  y = initialY;
  
  drawText('From:', rightX, y, { font: boldFont });
  y -= lineHeight;
  
  const companyLines = [
    `K.G.M. TRADERS`,
    `+91 86678 48501`,
    '3/1320-14, R.R. Nagar',
    'Paraipatti, Sivakasi',
    `Pincode: 626189`,
    `Invoice No: INV-${order.orderId}`,
    `Date: ${new Date(order.date).toLocaleDateString('en-IN')}`
  ];
  
  companyLines.forEach(line => {
    drawText(line, rightX, y);
    y -= lineHeight;
  });

  // Table Section
  y = Math.min(y, initialY - (customerLines.length * lineHeight)) - 20;
  drawTableHeader();

  // Table Rows
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
      `₹${item.price.toFixed(2)}`,
      `₹${amount.toFixed(2)}`,
    ];

    for (let j = 0; j < values.length; j++) {
      page.drawRectangle({
        x: columnPositions[j],
        y: y - rowHeight,
        width: columnWidths[j],
        height: rowHeight,
        borderWidth: 1,
        borderColor: rgb(0.8, 0.8, 0.8),
      });
      
      if (j === 1) { // Left-align description
        drawText(values[j], columnPositions[j] + textPadding, y - 8);
      } else { // Center-align other columns
        drawCenteredText(values[j], columnPositions[j], columnWidths[j], y - 8);
      }
    }

    y -= rowHeight;
  }

  // Total Section
  y -= 10;
  drawLine(y + rowHeight / 2);
  page.drawRectangle({
    x: columnPositions[3],
    y: y - rowHeight,
    width: columnWidths[3] + columnWidths[4],
    height: rowHeight,
    borderWidth: 1,
    borderColor: rgb(0.8, 0.8, 0.8),
  });
  
  drawText('Total', columnPositions[3] + textPadding, y - 8, { font: boldFont });
  drawText(`₹${totalAmount.toFixed(2)}`, columnPositions[4], y - 8, { font: boldFont, align: 'right' });

  // Footer
  y -= lineHeight * 3;
  drawText('Authorized Signature', pageWidth - margin - 150, y, { font: boldFont });

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
