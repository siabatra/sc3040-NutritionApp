const path = require('node:path');
try {
  process.loadEnvFile(path.resolve(__dirname, '../.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  throw new Error('Set EMAIL_USER and EMAIL_PASS in project/.env');
}

const express = require('express');
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');

try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("!!! ERROR INITIALIZING FIREBASE ADMIN SDK              !!!");
    console.error("!!! Ensure 'serviceAccountKey.json' exists and is valid !!!");
    console.error("!!! Have you added it to the '/server' directory?       !!!");
    console.error("!!! Is it added to .gitignore?                         !!!");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("Admin SDK Init Error:", error);
    process.exit(1);
}

const app = express();
const port = 4000;

app.use(cors());
app.use('/ai', require('./ai').router);
app.use(bodyParser.json());

const otpStore = {};
const OTP_EXPIRY_MINUTES = 5;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

app.post('/send-otp', async (req, res) => {
  const { email, purpose } = req.body;

  if (!email) { return res.status(400).json({ success: false, message: 'Email is required' }); }
  if (!/\S+@\S+\.\S+/.test(email)) { return res.status(400).json({ success: false, message: 'Invalid email format' }); }

  if (purpose === 'reset') {
     try {
         await admin.auth().getUserByEmail(email);
         console.log(`User ${email} found, proceeding with password reset OTP.`);
     } catch (userNotFoundError) {
         if (userNotFoundError.code === 'auth/user-not-found') {
             console.log(`Password reset request for non-existent user: ${email}`);
             return res.json({ success: true, message: 'If your email is registered, you will receive a code.' });
         } else {
             console.error(`Error checking user ${email} for password reset:`, userNotFoundError);
             return res.status(500).json({ success: false, message: 'Error checking user account.' });
         }
     }
  }

  const otp = generateOTP();
  const expiryTime = Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000;
  otpStore[email] = { otp, expires: expiryTime };

  const subject = purpose === 'reset'
      ? 'Your Password Reset Code'
      : 'Your App Verification Code';
  const textBody = `Your ${purpose === 'reset' ? 'password reset' : 'verification'} code is: ${otp}\nThis code will expire in ${OTP_EXPIRY_MINUTES} minutes.`;
  const htmlBody = `<p>Your ${purpose === 'reset' ? 'password reset' : 'verification'} code is: <strong>${otp}</strong></p><p>This code will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>`;

  const mailOptions = {
    from: `"Your App Name" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: subject,
    text: textBody,
    html: htmlBody,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP email sent successfully to ${email} for ${purpose}`);
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    console.error(`Error sending OTP email to ${email}:`, error);
    res.status(500).json({ success: false, message: 'Failed to send OTP email' });
  }
});

app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) { return res.status(400).json({ success: false, message: 'Email and OTP are required' }); }

  const storedData = otpStore[email];

  if (!storedData) { return res.status(400).json({ success: false, message: 'OTP not found or expired. Please request again.' }); }
  if (Date.now() > storedData.expires) { delete otpStore[email]; return res.status(400).json({ success: false, message: 'OTP has expired. Please request again.' }); }

  if (storedData.otp === otp) {
    delete otpStore[email]; 
    console.log(`OTP verified successfully for ${email}`);
    res.json({ success: true, message: 'OTP verified successfully' });
  } else {
    res.status(400).json({ success: false, message: 'Invalid OTP.' });
  }
});

app.post('/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return res.status(400).json({ success: false, message: 'Email and new password are required.' });
    }

    if (newPassword.length < 6) {
         return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    console.log(`Attempting password reset for ${email}`);

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        const uid = userRecord.uid;

        await admin.auth().updateUser(uid, {
            password: newPassword,
        });

        console.log(`Password successfully updated for user: ${uid} (${email})`);

        res.json({ success: true, message: 'Password updated successfully.' });

    } catch (error) {
        console.error(`Failed to reset password for ${email}:`, error);
         if (error.code === 'auth/user-not-found') {
             res.status(404).json({ success: false, message: 'User account not found.' });
         } else {
            res.status(500).json({ success: false, message: 'An error occurred while updating the password.' });
         }
    }
});

setInterval(() => {
  const now = Date.now();
  for (const email of Object.keys(otpStore)) {
    if (now > otpStore[email].expires) delete otpStore[email];
  }
}, 60 * 1000 * 5);

app.listen(port, () => {
  console.log(`OTP server listening at http://localhost:${port}`);
});