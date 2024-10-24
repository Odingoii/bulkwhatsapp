import React, { useState, useEffect } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import ClassicEditor from '@ckeditor/ckeditor5-build-classic';
import './SendMessage.css'; // Assuming styles are in this file
import { fetchGroups, fetchGroupContacts, sendMessageToGroup } from '../api'; // Import API functions

// GroupView component for selecting a group
function GroupView({ selectedGroup, onGroupSelect }) {
    const [groups, setGroups] = useState([]);

    // Fetch groups on component mount
    useEffect(() => {
        const loadGroups = async () => {
            try {
                const groupsData = await fetchGroups();
                setGroups(groupsData);
            } catch (error) {
                console.error('Error fetching groups:', error);
                setGroups([]); // Set an empty array on error
            }
        };

        loadGroups();
    }, []);

    const handleGroupChange = (event) => {
        const groupId = event.target.value;
        onGroupSelect(groupId);  // Call the passed prop function
    };

    return (
        <div className="group-view">
            <label htmlFor="group-select" className="label">Select Group: </label>
            <select
                id="group-select"
                value={selectedGroup}
                onChange={handleGroupChange}
                className="group-dropdown"
            >
                <option value="">-- Select Group --</option>
                {groups.map(group => (
                    <option key={group.id} value={group.id}>
                        {group.name}
                    </option>
                ))}
            </select>
        </div>
    );
}

function SendMessage() {
    const [selectedGroup, setSelectedGroup] = useState('');  // Track selected group
    const [message, setMessage] = useState('');
    const [groupContacts, setGroupContacts] = useState([]);
    const [selectedSalutation, setSelectedSalutation] = useState('Hey');
    const [useCustomName, setUseCustomName] = useState(false);

    const salutations = ['Hey', 'Hello', 'Dear', 'Hi'];

    // Fetch contacts when the selected group changes
    useEffect(() => {
        const loadGroupContacts = async () => {
            if (!selectedGroup) return;

            try {
                const contactsData = await fetchGroupContacts(selectedGroup);
                setGroupContacts(contactsData);
            } catch (error) {
                console.error('Error fetching group contacts:', error);
                setGroupContacts([]);
            }
        };

        loadGroupContacts();
    }, [selectedGroup]);

    // Define the handler to select a group
    const handleGroupSelect = (groupId) => {
        setSelectedGroup(groupId);  // Use the setSelectedGroup function here
    };

    const handleSendMessage = async () => {
        if (!selectedGroup || !message.trim()) {
            alert('Please select a group and enter a message.');
            return;
        }

        try {
            const personalizedMessages = groupContacts.map(contact => {
                const contactName = useCustomName ? contact.custom_name : contact.name;
                const finalMessage = `${selectedSalutation} ${contactName},\n\n${message.replace(/<[^>]*>/g, '')}`;
                return { phone: contact.phone, message: finalMessage };
            });

            const response = await sendMessageToGroup(selectedGroup, personalizedMessages);
            if (response?.success) {
                alert('Messages sent successfully!');
            } else {
                console.warn('Failed to send messages:', response?.message || 'Unknown error');
            }
        } catch (error) {
            console.error('Error sending messages:', error);
            alert(`Failed to send messages. Error: ${error.message}`);
        }
    };

    return (
        <div className="send-message-container">
            {/* Group selector */}
            <GroupView selectedGroup={selectedGroup} onGroupSelect={handleGroupSelect} />  {/* Pass handleGroupSelect */}

            {/* Message editor and salutation selection */}
            <div className="editor-container">
                <div className="salutation-selector">
                    <label htmlFor="salutation-select" className="label">Select Salutation: </label>
                    <select
                        id="salutation-select"
                        value={selectedSalutation}
                        onChange={(e) => setSelectedSalutation(e.target.value)}
                        className="salutation-dropdown"
                    >
                        {salutations.map((salutation, index) => (
                            <option key={index} value={salutation}>
                                {salutation}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Toggle for custom name */}
                <div className="custom-name-toggle">
                    <label htmlFor="custom-name-toggle" className="label">Use Custom Name: </label>
                    <input
                        type="checkbox"
                        id="custom-name-toggle"
                        checked={useCustomName}
                        onChange={(e) => setUseCustomName(e.target.checked)}
                        className="custom-name-checkbox"
                    />
                </div>

                {/* Message input via CKEditor */}
                <CKEditor
                    editor={ClassicEditor}
                    data={message}
                    onChange={(event, editor) => {
                        setMessage(editor.getData());
                    }}
                    config={{
                        toolbar: [
                            'heading', '|', 'bold', 'italic', 'link', 'bulletedList', 'numberedList', 'blockQuote', '|',
                            'undo', 'redo', 'alignment'
                        ],
                    }}
                    className="message-editor"
                />

                {/* Send message button */}
                <button onClick={handleSendMessage} className="send-btn">Send Message</button>
            </div>
        </div>
    );
}

export default SendMessage;
