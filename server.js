const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const PDFDocument = require("pdfkit");
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

// ✅ PDF Generation
function generatePDFInvoice(order, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", autoFirstPage: true });
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginBottom = 30;
    const lineHeight = 15;
    const columnWidths = [30, 200, 60, 60, 60];
    let y = 30;
    const currentDate = new Date(order.date).toLocaleDateString("en-IN");

    // Font
    const fontPath = path.join(__dirname, "public", "fonts", "NotoSans-Regular.ttf");
    if (fs.existsSync(fontPath)) {
      doc.registerFont("Noto", fontPath);
      doc.font("Noto");
    } else {
      doc.font("Helvetica");
    }

    // HEADER
    function drawHeader(isFirstPage) {
      y = isFirstPage ? 30 : 20;
      doc.fontSize(16).font("Helvetica-Bold").text("KUTTY PATTAS", 30, y);
      doc.fontSize(12).font("Helvetica").text("Invoice", pageWidth - 100, y);

      y += 15;
      doc.fontSize(10)
        .text("GSTIN No: XXXXXXXXXXXXXX", 30, y)
        .text("3/267-D Aj polytechnic opp,", 30, y += 10)
        .text("Chinnakamanpatti, Sivakasi - 626189", 30, y += 10)
        .text("Phone: +91 80153 25450 / +91 94420 38077", 30, y += 10)
        .text("Email: kuttypattascrackers@gmail.com", 30, y += 10)
        .text(`Order Date: ${currentDate}`, pageWidth - 150, y - 20)
        .text(`Invoice No: INV-${order.orderId}`, pageWidth - 150, y - 10);

      y += 10;
      doc.moveTo(30, y).lineTo(pageWidth - 30, y).stroke();
    }

    // FOOTER
    function drawFooter(pageNum, totalPages) {
      const footerY = pageHeight - marginBottom;
      doc.moveTo(30, footerY).lineTo(pageWidth - 30, footerY).stroke();
      doc.fontSize(10).fillColor("#000")
        .text("Thank you for your business!", pageWidth / 2, footerY + 5, { align: "center" })
        .text(`Page ${pageNum} of ${totalPages}`, pageWidth - 100, footerY + 5);
    }

    // TABLE HEADER
    function drawTableHeader(startY) {
      doc.fontSize(10).font("Helvetica-Bold")
        .text("S.No", 30, startY)
        .text("Description", 60, startY)
        .text("Qty", 270, startY, { width: 40, align: "center" })
        .text("Price", 330, startY, { width: 60, align: "center" })
        .text("Total", 410, startY, { width: 60, align: "center" });

      doc.moveTo(30, startY + 12).lineTo(pageWidth - 30, startY + 12).stroke();
      return startY + 20;
    }

    drawHeader(true);

    // BILL TO
    y += 15;
    doc.font("Helvetica-Bold").text("Billed To:", 30, y);
    doc.font("Helvetica").fontSize(10)
      .text(`Name: ${order.customer.name}`, 30, y += 10)
      .text(`Address: ${order.customer.address}`, 30, y += 10)
      .text(`Pincode: ${order.customer.pincode}`, 30, y += 10)
      .text(`Phone: ${order.customer.phone}`, 30, y += 10)
      .text(`Email: ${order.customer.email || "-"}`, 30, y += 10);

    // TABLE CONTENT
    y += 20;
    y = drawTableHeader(y);

    let totalAmount = 0;
    let sno = 1;

    for (const item of order.products) {
      const amount = item.price * item.qty;
      totalAmount += amount;

      const textHeight = 15;
      if (y + textHeight > pageHeight - marginBottom - 50) {
        drawFooter(doc.page.index + 1, null);
        doc.addPage();
        drawHeader(false);
        y = drawTableHeader(30);
      }

      doc.font("Helvetica").fontSize(10)
        .text(sno, 30, y)
        .text(item.name, 60, y)
        .text(item.qty.toString(), 270, y, { width: 40, align: "center" })
        .text(`₹${item.price.toFixed(2)}`, 330, y, { width: 60, align: "center" })
        .text(`₹${amount.toFixed(2)}`, 410, y, { width: 60, align: "center" });

      y += textHeight;
      sno++;
    }

    // TOTAL
    y += 10;
    doc.font("Helvetica-Bold").fontSize(12)
      .text(`Total Amount: ₹${totalAmount.toFixed(2)}`, pageWidth / 2 - 60, y);

    drawFooter(doc.page.index + 1, null);

    // BANK DETAILS PAGE
    doc.addPage();
    drawHeader(true);

    doc.font("Helvetica-Bold").fontSize(14).text("Banking and Payment Details", pageWidth / 2, 60, { align: "center" });

    const banks = [
      { name: "SBI", accountNo: "35950968662", ifsc: "SBIN0000961", branch: "Sivakasi" }
    ];

    y = 90;
    doc.fontSize(10).font("Helvetica-Bold")
      .text("Bank", 30, y)
      .text("Account No", 120, y)
      .text("Branch", 240, y)
      .text("IFSC", 350, y);
    y += 10;

    banks.forEach(bank => {
      doc.font("Helvetica").text(bank.name, 30, y)
        .text(bank.accountNo, 120, y)
        .text(bank.branch, 240, y)
        .text(bank.ifsc, 350, y);
      y += 15;
    });

    y += 30;
    doc.font("Helvetica-Bold").fontSize(14).text("Any Queries?", pageWidth / 2, y, { align: "center" });
    y += 20;

    doc.fontSize(12).font("Helvetica")
      .text("If you have any questions about this invoice, please contact us at:", 30, y)
      .text("Phone(GPay): +91 8015325450", 30, y + 15)
      .text("Phone: +91 9442038077", 30, y + 30)
      .text("Email: kuttypattascrackers@gmail.com", 30, y + 45);

    // QUOTE
    y += 75;
    doc.fontSize(14).font("Helvetica-Bold").text("Quote of the Day", pageWidth / 2, y, { align: "center" });

    const quote = "“You deserve the best, and we're here to deliver it every time!”";
    const author = "- Kutty Pattas Team";

    doc.fontSize(12).font("Times-Italic")
      .text(quote, pageWidth / 2, y + 20, { align: "center" })
      .text(author, pageWidth / 2, y + 35, { align: "center" });

    // FOOTERS FOR ALL PAGES
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      drawFooter(i + 1, totalPages);
    }

    // Finish
    doc.pipe(fs.createWriteStream(filePath));
    doc.end();
    resolve();
  });
}


function addTableHeader(doc, y) {
  doc.rect(30, y, doc.page.width - 60, 20).fill("#0b3f91");
  doc.fillColor("#fff")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("S.No", 35, y + 5)
    .text("Description", 65, y + 5)
    .text("Qty", 320, y + 5, { width: 40, align: "center" })
    .text("Price", 370, y + 5, { width: 60, align: "center" })
    .text("Total", 440, y + 5, { width: 60, align: "center" });
}

function addFooter(doc, pageNum, totalPages) {
  const footerY = doc.page.height - 30;
  doc.rect(0, footerY, doc.page.width, 30).fill("#0b3f91");
  doc.fillColor("#fff")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("KGM", 30, footerY + 10)
    .text("Thank You!", 0, footerY + 10, { align: "center" })
    .text(`Page ${pageNum} of ${totalPages}`, 0, footerY + 10, { align: "right" });
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
