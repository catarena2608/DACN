import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";

const ProtectedRoutes = ({ children }) => {
  const token = useSelector((state) => state.auth.accessToken);

  if (!token) return <Navigate to="/login" />;

  return children;
};

export default ProtectedRoutes;