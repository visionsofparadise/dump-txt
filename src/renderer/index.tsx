import { createRoot } from "react-dom/client";
import { App } from "./Components/App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("The editor root is missing.");

createRoot(root).render(<App />);
