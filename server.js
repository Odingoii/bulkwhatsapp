const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');
dotenv.config(); // Load environment variables

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true,
    },
});

// Middleware setup
app.use(express.json());
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.static(path.join(__dirname, 'build'))); // Serve React app
// Setup paths and public directory
const publicDir = path.join(__dirname, 'build');
const qrCodeImagePath = path.join(publicDir, 'qr-code.png');

if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

// Function to update the .env file with the new port
function updateEnvPort(newPort) {
    const envPath = path.join(__dirname, '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    // Update the PORT variable in the .env file
    const updatedEnvContent = envContent.replace(/PORT=\d+/, `PORT=${newPort}`);
    
    fs.writeFileSync(envPath, updatedEnvContent);
    console.log(`Updated .env file with new PORT: ${newPort}`);
}

// Define constants and global variables
let PORT = process.env.REACT_APP_PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
let clientInstance;
let isLoggedIn = false;
let statusUpdates = [];



app.post('/api/status', (req, res) => {
    const { status, data } = req.body;

    console.log('Received status update:', status, data);

    // Store the status updates in the array
    statusUpdates.push({ status, data, timestamp: new Date() });

    res.status(200).json({ message: 'Status received', status, data });
});

// Function to send status to API

const sendStatusToApi = async (status, data) => {
    try {
        const response = await axios.post(`${BASE_URL}/api/status`, {
            status: status,
            data: data
        });
        console.log('Status sent to API:', response.data);
    } catch (error) {
        console.error('Error sending status to API:', error);
    }
};
// Singleton pattern for WhatsApp client
const getClient = () => {
    if (!clientInstance) {
        clientInstance = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,  // Set to false if you want to see the browser
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // Adjust as necessary
            }
        });
        clientInstance.on('qr', (qr) => {
            qrcode.toDataURL(qr, async (err, qrCodeBase64) => {
                if (err) {
                    console.error('Error generating QR code:', err);
                    return;
                }
                console.log('QR code generated as base64 string.');
        
                // Send QR code as base64 to your API
                try {
                    const response = await axios.post(`${BASE_URL}/api/qr-code`, {
                        qrCode: qrCodeBase64
                    });
        
                    console.log('QR code sent to API successfully:', response.data);
                    sendStatusToApi('qr-code-updated', 'qr-code.png'); // Notify API
                } catch (error) {
                    console.error('Error sending QR code to API:', error);
                }
            });
        });

        clientInstance.on('ready', async () => {
            console.log('Client is ready!');
            isLoggedIn = true;
            sendStatusToApi('client-ready', null);
            sendStatusToApi('login-status', { loggedIn: isLoggedIn });

            try {
                await initializeDatabase();
                await saveContactsToDatabase();

                // Delete the QR code image after successful login
                if (fs.existsSync(qrCodeImagePath)) {
                    fs.unlinkSync(qrCodeImagePath);
                }
            } catch (err) {
                console.error('Error during initialization:', err);
            }
        });

        // Authentication and logout handling
        clientInstance.on('authenticated', () => {
            console.log('User is logged in!');
            isLoggedIn = true;
            sendStatusToApi('loggedIn', null);
            sendStatusToApi('login-status', { loggedIn: isLoggedIn });
        });

        clientInstance.on('auth_failure', () => {
            console.log('User is not logged in. Please scan the QR code again.');
            isLoggedIn = false;
            sendStatusToApi('NotloggedIn', null);
            sendStatusToApi('login-status', { loggedIn: isLoggedIn });
        });

        clientInstance.on('disconnected', (reason) => {
            console.log('Client has been logged out:', reason);
            isLoggedIn = false;
            sendStatusToApi('login-status', { loggedIn: isLoggedIn });
        });

        clientInstance.on('error', (error) => {
            console.error('Client error:', error);
        });

        // Initialize the client
        clientInstance.initialize();
    }
    return clientInstance;
};


// Initialize the database
async function initializeDatabase() {
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db', (err) => {
        if (err) {
            console.error('Error opening database:', err);
        } else {
            console.log('Database opened successfully');
        }
    });

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Create the groups table
            db.run(`CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            )`, (err) => {
                if (err) return reject(err);
            });

            // Create the contacts table
            db.run(`CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL UNIQUE,
                custom_name TEXT NOT NULL
            )`, (err) => {
                if (err) return reject(err);
            });


            // Create the group_contacts table
            db.run(`CREATE TABLE IF NOT EXISTS group_contacts (
                group_id INTEGER,
                contact_id INTEGER,
                FOREIGN KEY(group_id) REFERENCES groups(id),
                FOREIGN KEY(contact_id) REFERENCES contacts(id),
                UNIQUE(group_id, contact_id)
            )`, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

async function saveContactsToDatabase() {
    const contacts = await clientInstance.getContacts();
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');

    // Use a transaction to batch the operations
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        contacts.forEach((contact) => {
            const phoneNumber = contact.id._serialized || contact.id.user; // Get the phone number
            const contactName = contact.name || 'Unknown'; // Get the contact name, default to 'Unknown'

            const isValidContact = phoneNumber.endsWith('@c.us'); // Check if the phone number ends with @c.us

            if (isValidContact) {
                const cleanPhoneNumber = phoneNumber.replace(/@c\.us$/, '');
                const isValidName = contactName && contactName !== 'Unknown'; // Name should not be empty or 'Unknown'

                if (isValidName) {
                    // Use a prepared statement to check for existence
                    db.get(`SELECT id FROM contacts WHERE phone = ?`, [cleanPhoneNumber], (err, row) => {
                        if (err) {
                            console.error('Error querying the database:', err);
                        } else if (!row) {
                            // Contact does not exist, insert it without changing custom_name
                            db.run(`INSERT INTO contacts (name, phone) VALUES (?, ?)`, 
                                [contactName, cleanPhoneNumber], 
                                (err) => {
                                    if (err) {
                                        console.error('Error inserting new contact:', err);
                                    } else {
                                        console.log(`New contact added: ${contactName} (${cleanPhoneNumber})`);
                                    }
                                }
                            );
                        }
                        // No action taken if the contact already exists, so no log here
                    });
                }
                // No log for invalid names or formats, only process valid entries
            }
            // No log for invalid contacts, only process valid entries
        });

        db.run('COMMIT', (err) => {
            if (err) {
                console.error('Error committing the transaction:', err);
            } else {
                console.log('Transaction committed successfully.');
            }
            db.close(); // Close the database after all operations are completed
        });
    });
}

// Function to fetch groups and their contact counts
async function fetchGroupsWithContactCount() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');

        // SQL query to get group details along with the number of contacts
        const query = `
            SELECT g.id, g.name, COUNT(gc.contact_id) AS contactCount
            FROM groups g
            LEFT JOIN group_contacts gc ON g.id = gc.group_id
            GROUP BY g.id
        `;

        db.all(query, [], (err, rows) => {
            db.close(); // Ensure the DB connection is closed
            if (err) {
                console.error('Error fetching groups:', err);
                return reject(new Error('Error fetching groups'));
            }
            resolve(rows);
        });
    });
}

// API Endpoints
app.use(express.json()); // Ensure you can parse JSON bodies

let latestQrCode = null; // Store the latest QR code in memory

app.get('/api/groups-data', async (req, res) => {
    try {
        const groups = await fetchGroupsWithContactCount();
        res.json(groups); // Send the groups data as a JSON response
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

// POST endpoint to update contact details in a group
app.post('/api/groups/:groupId/contacts/:contactId', async (req, res) => {
    const { groupId, contactId } = req.params; // Extract groupId and contactId from URL params
    const { name, phone, custom_name } = req.body; // Extract the updated contact fields from the request body

    // Validate that at least one field is present for the update
    if (!name && !phone && !custom_name) {
        return res.status(400).json({ error: 'At least one field (name, phone, custom_name) must be provided for update' });
    }

    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');

    try {
        // Step 1: Check if the contact exists in the group
        const checkContactInGroup = `SELECT * FROM group_contacts WHERE group_id = ? AND contact_id = ?`;

        const row = await new Promise((resolve, reject) => {
            db.get(checkContactInGroup, [groupId, contactId], (err, row) => {
                if (err) {
                    console.error('Error checking contact in group:', err);
                    return reject(err);
                }
                resolve(row);
            });
        });

        if (!row) {
            // If the contact is not in the group, return an error
            return res.status(404).json({ error: 'Contact not found in the group' });
        }

        // Step 2: Update the contact's information if found
        let updateQuery = `UPDATE contacts SET `;
        const updateFields = [];
        const updateValues = [];

        // Dynamically add the fields to update based on the request body
        if (name) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (phone) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (custom_name) {
            updateFields.push('custom_name = ?');
            updateValues.push(custom_name);
        }

        updateQuery += updateFields.join(', ') + ` WHERE id = ?`;
        updateValues.push(contactId); // Add contactId at the end for the WHERE clause

        // Step 3: Execute the update query
        await new Promise((resolve, reject) => {
            db.run(updateQuery, updateValues, function (err) {
                if (err) {
                    console.error('Error updating contact:', err);
                    return reject(err);
                }
                resolve(this.changes); // this.changes gives the number of rows updated
            });
        });

        // Step 4: Return success response
        return res.status(200).json({ message: 'Contact updated successfully' });

    } catch (error) {
        console.error('Error in updating contact:', error);
        return res.status(500).json({ error: 'An error occurred while updating contact' });
    } finally {
        // Close the database connection after the operation is complete
        db.close();
    }
});
// Add contact to group API
app.post('/api/addtogroup', async (req, res) => {
    const { groupId, id } = req.body; // Extract groupId and contactId from the body
    const contact = { id }; // Create contact object from the body

    console.log('Received request to add contact to group:', { groupId, contact });

    try {
        // Step 1: Check if the contact exists in the contacts table
        db.get('SELECT id FROM contacts WHERE id = ?', [contact.id], (err, row) => {
            if (err) {
                console.error('Error querying contacts:', err);
                return res.status(500).json({ error: 'Database query failed' });
            }

            if (!row) {
                return res.status(404).json({ error: 'Contact not found' });
            }

            // Step 2: Insert contact into the group_contacts table
            db.run(
                `INSERT INTO group_contacts (group_id, contact_id) VALUES (?, ?)`,
                [groupId, contact.id],
                function (err) {
                    if (err) {
                        if (err.code === 'SQLITE_CONSTRAINT') {
                            return res.status(400).json({ error: 'Contact already added to this group' });
                        }
                        console.error('Error inserting contact into group:', err);
                        return res.status(500).json({ error: 'Failed to add contact to group' });
                    }

                    return res.json({ success: true, message: 'Contact added to group successfully' });
                }
            );
        });
    } catch (error) {
        console.error('Error adding contact to group:', error);
        return res.status(500).json({ error: 'Failed to add contact to group' });
    }
});
// POST route to receive the QR code from the client
app.post('/api/qr-code', (req, res) => {
    const { qrCode } = req.body;

    if (!qrCode) {
        return res.status(400).json({ message: 'No QR code provided.' });
    }

    // Save the QR code in-memory (or you can store it in a database if needed)
    latestQrCode = qrCode;

    console.log('QR code received and stored in memory.');
    res.json({ message: 'QR code stored successfully.' });
});

// GET route to serve the latest QR code
app.get('/api/qr-code', (req, res) => {
    if (!latestQrCode) {
        return res.status(404).json({ message: 'No QR code available.' });
    }

    // Respond with the latest QR code in base64 format
    res.json({ qrCode: latestQrCode });
});

// Function to fetch contacts from the database
async function fetchContacts(groupId) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');
        const query = `
            SELECT c.id, c.name, c.phone, c.custom_name
            FROM contacts c
            INNER JOIN group_contacts gc ON c.id = gc.contact_id
            WHERE gc.group_id = ?
        `;
        
        db.all(query, [groupId], (err, contacts) => {
            db.close(); // Close the DB connection in the callback
            if (err) {
                return reject(new Error('Error fetching contacts'));
            }
            if (contacts.length === 0) {
                return resolve([]); // Return an empty array if no contacts found
            }
            resolve(contacts);
        });
    });
}





// Existing /api/status endpoint to receive status updates
app.post('/api/status', (req, res) => {
    const { status, data } = req.body;

    console.log('Received status update:', status, data);

    // Store the status updates in the array
    statusUpdates.push({ status, data, timestamp: new Date() });

    res.status(200).json({ message: 'Status received', status, data });
});

// Fetch contacts from the database
app.get('/api/contacts', (req, res) => {
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');
    db.all("SELECT id, name, phone, custom_name FROM contacts WHERE name IS NOT NULL AND name != 'Unknown'", [], (err, rows) => {
        if (err) return res.status(500).send(err);
        res.json(rows);
    });
});


// Create a new group and add contacts to it
app.post('/api/groups', (req, res) => {
    const { name, contactIds } = req.body;

    // Validate input
    if (!name || !Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).send('Invalid input: Group name or contact IDs are missing.');
    }

    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');
    
    // Wrap the process in a transaction
    db.serialize(() => {
        db.run("BEGIN TRANSACTION"); // Start a transaction to ensure atomicity

        // Insert group into groups table
        db.run(`INSERT INTO groups (name) VALUES (?)`, [name], function(err) {
            if (err) {
                db.run("ROLLBACK"); // Rollback if error
                return res.status(500).send('Error inserting group: ' + err.message);
            }

            const groupId = this.lastID; // Get the new group's ID

            // Prepare placeholders for inserting contacts
            const placeholders = contactIds.map(() => '(?, ?)').join(', ');
            const sql = `INSERT INTO group_contacts (group_id, contact_id) VALUES ${placeholders}`;
            const params = contactIds.flatMap(contactId => [groupId, contactId]); // Flatten params for insertion

            // Insert contacts into group_contacts table
            db.run(sql, params, (err) => {
                if (err) {
                    db.run("ROLLBACK"); // Rollback if error
                    return res.status(500).send('Error inserting contacts into group: ' + err.message);
                }

                // Commit the transaction after successful insertions
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                        return res.status(500).send('Transaction commit error: ' + commitErr.message);
                    }

                    // Respond with the new group details
                    res.status(201).json({ id: groupId, name, contactIds });
                });
            });
        });
    });
});

// Fetch all groups from the database
app.get('/api/groups', (req, res) => {
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');
    db.all("SELECT id, name FROM groups", [], (err, rows) => {
        if (err) return res.status(500).send(err);
        res.json(rows);
    });
});
app.get('/api/status', (req, res) => {
    // Return the stored status updates
    res.status(200).json(statusUpdates);
});
// Fetch contacts for a specific group
app.get('/api/groups/:groupId/contacts', (req, res) => {
    const groupId = req.params.groupId;
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');
    const query = `
        SELECT c.id, c.name, c.phone, c.custom_name
        FROM contacts c
        INNER JOIN group_contacts gc ON c.id = gc.contact_id
        WHERE gc.group_id = ?
    `;
    db.all(query, [groupId], (err, rows) => {
        if (err) return res.status(500).send(err);
        res.json(rows);
    });
});
// Function to generate a random delay between message sends
function getRandomDelay(min = 3987, max = 7658) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}


// Function to send a WhatsApp message to a single contact
async function sendMessage(contactId, message) {
    try {
        const formattedContactId = `${contactId}@s.whatsapp.net`; // Formatting the contact ID
        const chat = await clientInstance.getChatById(formattedContactId); // Getting the chat by ID
        await chat.sendMessage(message); // Sending the message
        console.log(`Message sent to ${formattedContactId}`); // Log success
    } catch (error) {
        console.error(`Error sending message to ${contactId}:`, error); // Log error
        throw error; // Re-throw the error for handling in the caller function
    }
}

// API endpoint to send messages to multiple contacts with random delays
app.post('/api/send-message', async (req, res) => {
    const { message, contactIds } = req.body;

    // Basic validation of the request body
    if (!message || !contactIds || contactIds.length === 0) {
        return res.status(400).send('Invalid input');
    }

    try {
        // Create an array of promises, each with a random delay
        const promises = contactIds.map(contactId => {
            return new Promise((resolve) => {
                setTimeout(async () => {
                    try {
                        await sendMessage(contactId, message); // Send message to each contact
                        resolve(); // Resolve when the message is sent successfully
                    } catch (error) {
                        resolve(); // Continue with other contacts even if one fails
                    }
                }, getRandomDelay()); // Random delay between messages
            });
        });

        // Wait for all promises to resolve
        await Promise.all(promises);

        // Send a success response after all messages are sent
        res.status(200).send('Messages sent successfully');
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).send('Error sending messages');
    }
});
// API endpoint to delete a group
app.delete('/api/groups/:groupId', async (req, res) => {
    const { groupId } = req.params;
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');

    db.serialize(() => {
        db.run(`DELETE FROM group_contacts WHERE group_id = ?`, [groupId], (err) => {
            if (err) {
                console.error('Error deleting contacts from group:', err);
                return res.status(500).json({ message: 'Error deleting contacts from group', error: err.message });
            }
        });

        db.run(`DELETE FROM groups WHERE id = ?`, [groupId], (err) => {
            if (err) {
                console.error('Error deleting group:', err);
                return res.status(500).json({ message: 'Error deleting group', error: err.message });
            }
            res.status(200).json({ message: 'Group deleted successfully' });
        });
    });

    db.close();
});

// API endpoint to remove contacts from a group
app.post('/api/removecontact', async (req, res) => {
    const { groupId, contactIds } = req.body; // Retrieve groupId and contactIds from request
    const db = new sqlite3.Database(process.env.DB_PATH || 'contacts.db');

    // Prepare the SQL statement to delete contacts from the group
    const deleteContacts = db.prepare(`DELETE FROM group_contacts WHERE group_id = ? AND contact_id = ?`);

    db.serialize(() => {
        // If contactIds is not an array, wrap it into an array
        const idsToDelete = Array.isArray(contactIds) ? contactIds : [contactIds];
        
        idsToDelete.forEach(contactId => {
            deleteContacts.run(groupId, contactId, (err) => {
                if (err) {
                    console.error('Error removing contact from group:', err);
                    return res.status(500).json({ error: 'Failed to remove contact from group' });
                }
            });
        });

        deleteContacts.finalize(() => {
            res.status(200).json({ message: 'Contacts removed from group successfully' });
        });
    });

    db.close(); // Ensure the DB connection is closed after the operation
});


// Start the server
const startServer = () => {
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        updateEnvPort(PORT); // Update the .env file with the current port
    });
};

// Ensure that the server is started
startServer();
getClient(); // Initialize WhatsApp client