const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const nodemailer = require("nodemailer");
const app = express();
require("dotenv").config(); // 🔑 Load env variables

// ✅ Middleware
app.use(cors());
// app.use(express.static("public"));
app.use(bodyParser.json());
const path = require("path");

// Serve all static files from 'public' folder//

// app.use(express.static(path.join(__dirname, "public")));


// ✅ MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.once("open", () => console.log("✅ MongoDB Connected"));
db.on("error", (err) => console.log("❌ DB Error:", err));

// ✅ Mongoose Schema
const OrderSchema = new mongoose.Schema({
  orderId: { type: Number, unique: true }, // 🟢 Changed from String to Number
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
const Counter = mongoose.model("Counter", CounterSchema);
async function getNextOrderId() {
  const counter = await Counter.findOneAndUpdate(
    { name: "orderId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true } // create if not exists
  );
  return counter.seq;
}


const Order = mongoose.model("Order", OrderSchema);

// ✅ Default route
app.get("/", (req, res) => {
  res.send("🔥 KGM Cracker Ordering Server is Live!");
});

// ✅ POST Checkout Route
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

    setTimeout(() => {
      fs.unlink(pdfPath, () => {});
    }, 60000);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ success: false });
  }
});



function generatePDFInvoice(order, filePath) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", autoFirstPage: true });

    // Register ₹ supported font
    const fontPath = path.join(__dirname, "public", "fonts", "NotoSans-Regular.ttf");
    doc.registerFont("Noto", fontPath);
    doc.font("Noto");

    // Header
    doc.rect(0, 0, doc.page.width, 100).fill('#0b3f91');
    try {
      const logoPath = path.join(__dirname, "public", "assets", "img", "logobg.png");
      doc.image(logoPath, doc.page.width - 110, 15, { width: 80 });
    } catch (err) {
      console.log("Logo missing or error loading logo");
    } 
    doc.fillColor('#ffffff')
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("INVOICE", 30, 35);

    // Address sections
    let y = 120;
    doc.fillColor('#000000').fontSize(12).font("Helvetica-Bold").text("Bill To:", 30, y);
    doc.font("Helvetica")
      .text(order.customer.name, 30)
      .text(order.customer.phone, 30)
      .text(order.customer.address, 30)
      .text(`Pincode: ${order.customer.pincode}`, 30);

    doc.font("Helvetica-Bold").text("From:", 330, y);
    doc.font("Helvetica")
      .text("KGM Crackers", 330)
      .text("7904303676", 330)
      .text("6/7491-A, Samy Puram Colony, Sivakasi", 330);

    // Date + Invoice
    y = doc.y + 20;
    doc.font("Helvetica")
      .text(`Date: ${new Date(order.date).toLocaleDateString("en-IN")}    Invoice No: INV-${order.orderId}`, 30, y);

    // Table header
    y = doc.y + 30;
    addTableHeader(doc, y);
    y += 25;

    let totalAmount = 0;
    let sno = 1;

    for (const item of order.products) {
      const amount = item.price * item.qty;
      totalAmount += amount;

      if (y > doc.page.height - 150) {
        addFooter(doc, doc.page.index + 1, null);
        doc.addPage();
        y = 30;
        addTableHeader(doc, y);
        y += 25;
      }

      doc.font("Noto").fillColor('#000000')
        .text(sno, 35, y)
        .text(item.name, 65, y, { width: 240 })
        .text(item.qty.toString(), 320, y, { width: 40, align: "center" })
        .text(`₹${item.price.toFixed(2)}`, 370, y, { width: 60, align: "center" })
        .text(`₹${amount.toFixed(2)}`, 440, y, { width: 60, align: "center" });

      y += 20;
      sno++;
    }

    // Sub Total
    doc.rect(370, y + 10, 130, 20).fill('#0b3f91');
    doc.fillColor('#ffffff')
      .font("Helvetica-Bold")
      .text("Sub Total", 375, y + 15)
      .text(`₹${totalAmount.toFixed(2)}`, 460, y + 15, { align: "right", width: 40 });

    // Signature
    doc.moveDown(5);
    doc.font("Helvetica-Bold").fillColor('#000000')
      .text("Authorized Signature", doc.page.width - 200, doc.y + 30);

    // Final Footers on all pages
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      addFooter(doc, i + 1, totalPages);
    }

    doc.pipe(fs.createWriteStream(filePath));
    doc.end();
    resolve();
  });
}

// Table Header
function addTableHeader(doc, y) {
  doc.rect(30, y, doc.page.width - 60, 20).fill('#0b3f91');
  doc.fillColor('#ffffff')
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("S.No", 35, y + 5)
    .text("Description", 65, y + 5)
    .text("Qty", 320, y + 5, { width: 40, align: "center" })
    .text("Price", 370, y + 5, { width: 60, align: "center" })
    .text("Total", 440, y + 5, { width: 60, align: "center" });
}

// Footer
function addFooter(doc, pageNum, totalPages) {
  const footerY = doc.page.height - 30;
  doc.rect(0, footerY, doc.page.width, 30).fill('#0b3f91');
  doc.fillColor('#ffffff')
    .fontSize(10)
    .font("Helvetica-Bold")
    .text("KGM", 30, footerY + 10)
    .text("Thank You!", 0, footerY + 10, { align: "center" })
    .text(`Page ${pageNum} of ${totalPages}`, 0, footerY + 10, { align: "right" });
}

module.exports = generatePDFInvoice;

// ✅ Send Email with Invoice PDF
function sendInvoiceEmail(toEmail, pdfPath, orderId) {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
     auth: {
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS
}

    });

    const mailOptions = {
      from: `KGM Crackers <${process.env.EMAIL_USER}>`, // ✅ Use same as auth user
      to: toEmail,
      bcc: "gkmv0413@gmail.com",
      subject: `🧨 Your Invoice - KGM Crackers Order #${orderId}`,
      text: `Dear Customer,\n\nThank you for your order!\nPlease find the attached invoice for your order #${orderId}.\n\nRegards,\nKGM Crackers Team`,
      attachments: [
        {
          filename: `invoice_${orderId}.pdf`,
          path: pdfPath,
        },
      ],
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
