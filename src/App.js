import React, { useReducer, useEffect, useContext, createContext } from 'react';
import { fetchLoginStatus } from './api'; // Import the API call from api.js
import QRCodeScanner from './components/QRCodeScanner';
import Sidebar from './components/Sidebar';
import GroupView from './components/GroupView';
import SendMessage from './components/SendMessage';
import ContactSelection from './components/ContactSelection';
import LoadingSpinner from './components/LoadingSpinner';
import GroupDetail from './components/GroupDetail';
import './App.css'; // Ensure this contains the global styles

// Create a context for the app state
const AppContext = createContext();

// Action types for the reducer
export const ACTIONS = {
    SET_LOGGED_IN: 'SET_LOGGED_IN',
    SET_LOADING: 'SET_LOADING',
    SET_ACTIVE_PAGE: 'SET_ACTIVE_PAGE',
    SET_REDIRECT: 'SET_REDIRECT',
};

// Initial state for the reducer
const initialState = {
    loggedIn: false,
    loading: true,
    activePage: 'loading',
    redirectToSendMessage: false,
};

// Reducer function to manage state transitions
function appReducer(state, action) {
    switch (action.type) {
        case ACTIONS.SET_LOGGED_IN:
            return { ...state, loggedIn: action.payload };
        case ACTIONS.SET_LOADING:
            return { ...state, loading: action.payload };
        case ACTIONS.SET_ACTIVE_PAGE:
            return { ...state, activePage: action.payload, loading: false };
        case ACTIONS.SET_REDIRECT:
            return { ...state, redirectToSendMessage: action.payload };
        default:
            return state;
    }
}

// Custom hook to use the AppContext
export const useAppContext = () => useContext(AppContext);

function App() {
    const [state, dispatch] = useReducer(appReducer, initialState);

    // Function to fetch login status from the .env file through the backend
    const handleLoginStatus = async () => {
        try {
            const statusData = await fetchLoginStatus();
            const { status } = statusData; // Focus on the "status" field

            if (!status) {
                dispatch({ type: ACTIONS.SET_ACTIVE_PAGE, payload: 'loading' });
            } else {
                switch (status) {
                    case 'loggedOut':
                        dispatch({ type: ACTIONS.SET_ACTIVE_PAGE, payload: 'qr-code-updated' });
                        break;
                    case 'loggedIn':
                        dispatch({ type: ACTIONS.SET_ACTIVE_PAGE, payload: 'sendMessage' });
                        dispatch({ type: ACTIONS.SET_LOGGED_IN, payload: true });
                        dispatch({ type: ACTIONS.SET_LOADING, payload: false });
                        break;
                    default:
                        dispatch({ type: ACTIONS.SET_ACTIVE_PAGE, payload: 'loading' });
                        dispatch({ type: ACTIONS.SET_LOGGED_IN, payload: false });
                }
            }
        } catch (error) {
            console.error('Error fetching login status:', error);
            dispatch({ type: ACTIONS.SET_LOADING, payload: false });
        }
    };

    // Poll the backend at regular intervals to fetch login status
    useEffect(() => {
        const pollLoginStatus = () => {
            handleLoginStatus();
        };

        if (!state.loggedIn) {
            const interval = setInterval(pollLoginStatus, 15000);
            return () => clearInterval(interval);
        }
    }, [state.loggedIn]);

    return (
        <AppContext.Provider value={{ state, dispatch }}>
            <div className="app-frame">
                {state.loading && <LoadingSpinner />}
                {state.activePage === 'qr-code-updated' && <QRCodeScanner />}
                <div className={`content-wrapper ${state.loading || state.activePage === 'qr-code-updated' ? 'blurred' : ''}`}>
                    <Sidebar disabled={state.loading} />
                    <div className="main-content">
                        {state.activePage === 'sendMessage' && <SendMessage />}
                        {state.activePage === 'groups' && <GroupView />}
                        {state.activePage === 'createGroup' && <ContactSelection />}
                        {state.activePage === 'groupDetail' && <GroupDetail groupId={state.redirectToSendMessage} />}
                    </div>
                </div>
            </div>
        </AppContext.Provider>
    );
}

export default App;
