import { createRoot } from "react-dom/client";
import { Demonstration } from "./Demonstration";
import "@dump-txt/ui/styles.css";
import "@dump-txt/rig/styles.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("The demonstration root is missing.");

createRoot(root).render(<Demonstration />);
