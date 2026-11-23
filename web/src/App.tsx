import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import AppShell from "./components/AppShell";
import Landing from "./pages/Landing";
import AuthPage from "./pages/Auth";
import Chat from "./pages/Chat";
import Documents from "./pages/Documents";
import Evaluation from "./pages/Evaluation";
import Usage from "./pages/Usage";
import Members from "./pages/Members";
import Settings from "./pages/Settings";
import { Spinner } from "./components/ui";

function Home() {
  const { user, workspaces, loading } = useAuth();
  if (loading) return <div className="h-full grid place-items-center"><Spinner /></div>;
  if (user && workspaces[0]) return <Navigate to={`/w/${workspaces[0].id}`} replace />;
  if (user) return <Navigate to="/w/new" replace />;
  return <Landing />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/w/:ws" element={<AppShell />}>
        <Route index element={<Chat />} />
        <Route path="c/:conv" element={<Chat />} />
        <Route path="documents" element={<Documents />} />
        <Route path="evaluation" element={<Evaluation />} />
        <Route path="usage" element={<Usage />} />
        <Route path="members" element={<Members />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
