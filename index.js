const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// File paths
const usersFilePath = path.join(__dirname, 'users.json');
const uploadsDir = path.join(__dirname, 'uploads');

// Ensure necessary directories and files exist
if (!fs.existsSync(usersFilePath)) {
    fs.writeFileSync(usersFilePath, JSON.stringify([]));
}

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const { originalname } = file;
        const { filename } = req.body;
        const ext = path.extname(originalname);
        const base = path.basename(filename, ext);
        const finalFilename = `${base}-${Date.now()}${ext}`;
        cb(null, finalFilename);
    }
});

const upload = multer({ storage });

// Helper functions
function readUsers() {
    return JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
}

function writeUsers(users) {
    fs.writeFileSync(usersFilePath, JSON.stringify(users));
}

function findUser(username) {
    const users = readUsers();
    return users.find(user => user.username === username);
}

function findUserByEmail(email) {
    const users = readUsers();
    return users.find(user => user.email === email);
}

function generateToken() {
    return crypto.randomBytes(20).toString('hex');
}

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'basilmailtd@gmail.com',
        pass: 'uzxtolejmfoyrzcd'
    }
});

// Routes
app.post('/api/register', (req, res) => {
    const { username, password, email } = req.body;
    const users = readUsers();

    if (findUser(username) || findUserByEmail(email)) {
        return res.status(400).json({ error: 'Username or email already exists' });
    }

    users.push({ username, password, email, files: [], resetToken: null, resetTokenExpiry: null });
    writeUsers(users);
    res.status(200).json({ message: 'User registered successfully' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = findUser(username);

    if (!user || user.password !== password) {
        return res.status(400).json({ error: 'Invalid username or password' });
    }

    res.status(200).json({ message: 'Login successful' });
});

app.post('/api/request-reset-password', (req, res) => {
    const { email } = req.body;
    const user = findUserByEmail(email);

    if (!user) {
        return res.status(400).json({ error: 'Email not found' });
    }

    const token = generateToken();
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour

    user.resetToken = token;
    user.resetTokenExpiry = resetTokenExpiry;

    const users = readUsers();
    const userIndex = users.findIndex(u => u.email === email);
    users[userIndex] = user;
    writeUsers(users);

    const resetLink = `http://localhost:${port}/change-password?token=${token}`;

    transporter.sendMail({
        from: 'basilmailtd@gmail.com',
        to: email,
        subject: 'Password Reset Request',
        text: `You requested a password reset. Click the link to reset your password: ${resetLink}`
    });

    res.status(200).json({ message: 'Password reset link has been sent to your email' });
});

app.post('/api/change-password', (req, res) => {
    const { token, newPassword } = req.body;
    const users = readUsers();
    const user = users.find(user => user.resetToken === token && user.resetTokenExpiry > Date.now());

    if (!user) {
        return res.status(400).json({ error: 'Invalid or expired token' });
    }

    user.password = newPassword;
    user.resetToken = null;
    user.resetTokenExpiry = null;

    const userIndex = users.findIndex(u => u.email === user.email);
    users[userIndex] = user;
    writeUsers(users);

    res.status(200).json({ message: `Mật khẩu mới của ${user.username} là ${newPassword}`, username: user.username });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    const { username, filename } = req.body;
    const user = findUser(username);

    if (!user) {
        return res.status(400).json({ error: 'User not found' });
    }

    if (user.files.find(file => file.originalname === filename)) {
        return res.status(400).json({ error: 'Filename already exists' });
    }

    user.files.push({ filename: req.file.filename, originalname: filename, shared: false });
    const users = readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    users[userIndex] = user;
    writeUsers(users);

    res.status(200).json({ message: 'File uploaded successfully' });
});

app.get('/api/files/:username', (req, res) => {
    const { username } = req.params;
    const user = findUser(username);

    if (!user) {
        return res.status(400).json({ error: 'User not found' });
    }

    res.status(200).json(user.files);
});

app.get('/api/shared/:filename', (req, res) => {
    const { filename } = req.params;
    const users = readUsers();

    const user = users.find(user => user.files.find(file => file.filename === filename && file.shared));
    if (!user) {
        return res.status(404).sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
    }

    const filePath = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
    }
});

app.delete('/api/delete/:username/:filename', (req, res) => {
    const { username, filename } = req.params;
    const user = findUser(username);

    if (!user) {
        return res.status(400).json({ error: 'User not found' });
    }

    const fileIndex = user.files.findIndex(file => file.filename === filename);
    if (fileIndex === -1) {
        return res.status(400).json({ error: 'File not found' });
    }

    user.files.splice(fileIndex, 1);
    const users = readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    users[userIndex] = user;
    writeUsers(users);

    fs.unlinkSync(path.join(__dirname, 'uploads', filename));
    res.status(200).json({ message: 'File deleted successfully' });
});

app.put('/api/share/:username/:filename', (req, res) => {
    const { username, filename } = req.params;
    const { shared } = req.body;
    const user = findUser(username);

    if (!user) {
        return res.status(400).json({ error: 'User not found' });
    }

    const file = user.files.find(file => file.filename === filename);
    if (!file) {
        return res.status(400).json({ error: 'File not found' });
    }

    file.shared = shared;
    const users = readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    users[userIndex] = user;
    writeUsers(users);

    res.status(200).json({ message: 'File sharing status updated' });
});

app.get('/api/download/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'file-not-found.html'));
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/reset', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/change-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'change-password.html'));
});

app.get('/upload', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
