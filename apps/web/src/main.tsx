import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Home from "./routes/Home";
import Invoices from "./routes/Invoices";
import Create from "./routes/Create";
import InvoiceDetail from "./routes/InvoiceDetail";
import Record from "./routes/Record";
import Score from "./routes/Score";
import Attacks from "./routes/Attacks";
import Primitive from "./routes/Primitive";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Home /> },
      { path: "invoices", element: <Invoices /> },
      { path: "create", element: <Create /> },
      { path: "invoice/:id", element: <InvoiceDetail /> },
      { path: "record", element: <Record /> },
      { path: "score", element: <Score /> },
      { path: "attacks", element: <Attacks /> },
      { path: "primitive", element: <Primitive /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
