import { createContext } from "react";

// The auth context value is provided by <AuthProvider> (AuthContext.jsx) and read
// via useAuth() (useAuth.js). Kept in its own module so each of those files has a
// single, fast-refresh-friendly export.
export const AuthContext = createContext(null);
