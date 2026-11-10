import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { Controller } from "./application/controller";
import { SaveStore } from "./storage/save";
import { validateLevel } from "./domain/rules";
import data from "../content/levels/bloom-01.json";
import "./ui/style.css";

const level = validateLevel(data);
const saves = new SaveStore(
  {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  },
  level,
);
const controller = new Controller(level, saves);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App controller={controller} />
  </React.StrictMode>,
);
