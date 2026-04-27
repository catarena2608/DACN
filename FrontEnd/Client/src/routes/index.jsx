import { Routes, Route } from "react-router-dom";
import Login from "../components/login/Login";
import Layout from "../components/layout/Layout";
import ProtectedRoutes from "./ProtectedRoutes";

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoutes>
            <Layout />
          </ProtectedRoutes>
        }
      />
    </Routes>
  );
};

export default AppRoutes;