import React from "react";
import { createRoot } from "react-dom/client";
import { Prototype } from "./ui/Prototype";
import "./ui/style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Prototype />
  </React.StrictMode>,
);
