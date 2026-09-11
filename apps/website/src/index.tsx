import { createRoot } from "react-dom/client";
import { Website } from "./Website";
import "@dump-txt/ui/styles.css";
import "@dump-txt/rig/styles.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("The website root is missing.");

createRoot(root).render(<Website />);
