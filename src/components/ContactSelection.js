import React, { useState, useEffect } from 'react';
import './ContactSelection.css';
import useAppContext from '../App';

function ContactSelection() {
    const { dispatch } = useAppContext(); // Get global state dispatch
    const [contacts, setContacts] = useState([]); // List of contacts
    const [selectedContacts, setSelectedContacts] = useState([]); // Selected contacts for group
    const [groupName, setGroupName] = useState(''); // Group name input
    const [error, setError] = useState(''); // Error message
    const [loading, setLoading] = useState(true); // Loading state
    const [searchQuery, setSearchQuery] = useState(''); // Search query for filtering contacts
    const [existingGroups, setExistingGroups] = useState([]); // List of existing groups for name validation

    // Fetch contacts and existing groups on component mount
    useEffect(() => {
        const fetchContactsAndGroups = async () => {
            try {
                const [contactsResponse, groupsResponse] = await Promise.all([
                    window.api.getContacts(), // Fetch contacts
                    window.api.getGroups()    // Fetch existing groups for validation
                ]);
                setContacts(contactsResponse);
                setExistingGroups(groupsResponse.map(group => group.name.toLowerCase())); // Store group names in lowercase
                setLoading(false);
            } catch (err) {
                console.error('Error fetching data:', err);
                setError('Failed to load contacts or groups.');
                setLoading(false);
            }
        };

        fetchContactsAndGroups();
    }, []);

    // Handle contact selection/deselection
    const handleContactSelection = (contactId) => {
        setSelectedContacts((prevSelected) => {
            if (prevSelected.includes(contactId)) {
                // Deselect the contact if already selected
                return prevSelected.filter(id => id !== contactId);
            } else {
                // Select the contact
                return [...prevSelected, contactId];
            }
        });
    };

    // Handle form submission to create the group
    const handleCreateGroup = async () => {
        const trimmedGroupName = groupName.trim().toLowerCase();

        // Validate group name
        if (!groupName.trim()) {
            setError('Group name cannot be empty.');
            return;
        }

        // Check if group name already exists
        if (existingGroups.includes(trimmedGroupName)) {
            setError('Group name already exists. Please choose a different name.');
            return;
        }

        // Validate contact selection
        if (selectedContacts.length === 0) {
            setError('Please select at least one contact.');
            return;
        }

        // Log the data being sent to the API
        const groupData = {
            name: groupName.trim(),
            contactIds: selectedContacts
        };
        console.log('Data being sent to createGroup API:', groupData); // Log the group data

        try {
            const response = await window.api.createGroup(groupData);

            // Check if the response indicates success
            if (response && response.success) {
                // Group creation successful, redirect or reset form
                dispatch({ type: 'SET_ACTIVE_PAGE', payload: 'groups' }); // Navigate to groups view
            } else if (response.error) {
                // Handle error messages correctly
                setError(response.error);
            } else {
                // Handle unexpected response
                setError('Unexpected response from the server.');
            }
        } catch (err) {
            console.error('Error creating group:', err);
            setError('Failed to create the group.');
        }
    };

    // Filter contacts based on search query
    const filteredContacts = contacts.filter(contact => 
        contact.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="create-group-container">
            <h2>Create Group</h2>

            {loading ? (
                <p>Loading contacts...</p>
            ) : (
                <>
                    <div className="group-name-input">
                        <label htmlFor="group-name">Group Name</label>
                        <input
                            type="text"
                            id="group-name"
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            placeholder="Enter group name"
                        />
                    </div>

                    {/* Search input for filtering contacts */}
                    <div className="search-container">
                        <input
                            type="text"
                            placeholder="Search contacts..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input"
                        />
                    </div>

                    <div className="contact-list">
                        <h3>Select Contacts</h3>
                        {/* Display contacts in a table */}
                        <table className="contact-table">
                            <thead>
                                <tr>
                                    <th>Select</th>
                                    <th>Name</th>
                                    <th>Contact</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredContacts.map(contact => (
                                    <tr key={contact.id} className={selectedContacts.includes(contact.id) ? 'selected' : ''}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selectedContacts.includes(contact.id)}
                                                onChange={() => handleContactSelection(contact.id)}
                                            />
                                        </td>
                                        <td>{contact.name}</td>
                                        <td>{contact.phone}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {error && <p className="error-message">{error}</p>}

                    <button className="create-group-button" onClick={handleCreateGroup}>Create Group</button>
                </>
            )}
        </div>
    );
}

export default ContactSelection;
