const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// 1. Ver estado
app.get("/status", (req, res) => {
  res.json({ status: "online", uptime: process.uptime() });
});

// 2. Comandos de Energía
app.post("/command/:type", (req, res) => {
  const { type } = req.params;
  let command = "";

  if (type === "shutdown") command = "shutdown /s /t 60";
  else if (type === "reboot") command = "shutdown /r /t 60";
  else if (type === "cancel") command = "shutdown /a";

  if (!command) return res.status(400).json({ error: "Comando inválido" });

  exec(command, (err) => {
    if (err) return res.status(500).json({ error: "Error al ejecutar" });
    res.json({ message: `Acción ${type} iniciada correctamente` });
  });
});

// 3. Sistema de archivos (Para que el explorador funcione)
app.get("/files", (req, res) => {
  const targetPath = req.query.path || "C:\\";
  try {
    const files = fs.readdirSync(targetPath, { withFileTypes: true });
    const result = files.map((f) => ({
      name: f.name,
      path: path.join(targetPath, f.name),
      isDirectory: f.isDirectory(),
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "No se puede acceder a la ruta" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`> Servidor PC activo en puerto ${PORT}`);
});
