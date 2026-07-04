import WorkflowManager from "./components/WorkflowManager";
import { ToastProvider } from "./components/Toast";

const App = () => (
  <ToastProvider>
    <WorkflowManager />
  </ToastProvider>
);

export default App;
