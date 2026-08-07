import { createRoot } from "react-dom/client";
import { Visualiser } from "../app/Visualiser";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The application root element is missing.");
}

createRoot(root).render(<Visualiser />);
