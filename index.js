const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { log } = require("console");

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

// A. LISTAR APPS ABIERTAS (Solo las que tienen ventana visible)
app.get("/apps/running", (req, res) => {
  console.log("\n--- [GET] /apps/running: Consultando procesos ---");

  // Añadimos 'Path' al Select-Object.
  // Nota: Algunos procesos de sistema o apps de la Tienda de Windows podrían devolver esto vacío (null).
  const psCommand = `Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Name, Id, MainWindowTitle, Path | ConvertTo-Json -Compress`;

  exec(
    `powershell -Command "${psCommand}"`,
    { maxBuffer: 1024 * 500 },
    (err, stdout, stderr) => {
      if (err) {
        console.error("❌ Error ejecutando PowerShell:", err);
        return res
          .status(500)
          .json({ error: "Error en ejecución de comandos" });
      }

      if (stderr) {
        console.warn("⚠️ Advertencia de PowerShell:", stderr);
      }

      const output = stdout.trim();
      console.log("📄 Salida bruta de PowerShell:", output || "(vacío)");

      if (!output) {
        console.log("ℹ️ No se detectaron ventanas abiertas.");
        return res.json([]);
      }

      try {
        let processes = JSON.parse(output);

        // PowerShell a veces devuelve un objeto si es uno solo, o array si son varios
        if (!Array.isArray(processes)) {
          processes = [processes];
        }

        console.log(`✅ Enviando ${processes.length} procesos al móvil.`);
        res.json(processes);
      } catch (e) {
        console.error("❌ Error al parsear JSON:", e.message);
        console.log("Contenido que falló al parsear:", output);
        res.status(500).json({ error: "Error de formato en los datos del PC" });
      }
    },
  );
});

// ABRIR APP CON CONFIRMACIÓN DE 5 SEGUNDOS
app.post("/apps/open", (req, res) => {
  const { appPath } = req.body;
  if (!appPath) return res.status(400).json({ error: "Ruta vacía" });

  console.log(`> Lanzando: ${appPath}`);

  // 1. Damos la orden de abrir
  exec(`start "" "${appPath}"`, (startErr) => {
    if (startErr) console.error("Error al lanzar CMD:", startErr);
  });

  // 2. Extraemos el nombre del proceso (ej: de "AnyDesk.exe" a "AnyDesk")
  const processName = path.basename(appPath, ".exe");

  // 3. Bucle de comprobación (Polling)
  let attempts = 0;
  const maxAttempts = 10; // 10 intentos x 500ms = 5 segundos

  const checkInterval = setInterval(() => {
    attempts++;
    // Preguntamos a PowerShell si el proceso ya existe
    exec(
      `powershell -Command "Get-Process -Name '${processName}' -ErrorAction SilentlyContinue"`,
      (err, stdout) => {
        if (stdout.trim()) {
          // ¡Lo encontró!
          clearInterval(checkInterval);
          return res.json({ message: "App abierta y confirmada" });
        }

        // Si llegamos a los 5 segundos y no se abrió
        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          return res
            .status(500)
            .json({ error: "Timeout: No se detectó la app tras 5s" });
        }
      },
    );
  }, 500);
});

// CERRAR APP CON CONFIRMACIÓN DE 5 SEGUNDOS
app.post("/apps/close", (req, res) => {
  const { pid } = req.body;

  console.log(`> Cerrando PID: ${pid}`);
  exec(`taskkill /F /PID ${pid}`, (err) => {
    if (err) console.error("Error en taskkill:", err);
  });

  let attempts = 0;
  const checkInterval = setInterval(() => {
    attempts++;
    // Preguntamos a PowerShell si el proceso AÚN existe
    exec(
      `powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue"`,
      (err, stdout) => {
        if (!stdout.trim()) {
          // Si no devuelve nada, es que ya murió (éxito)
          clearInterval(checkInterval);
          return res.json({ message: "App cerrada y confirmada" });
        }

        if (attempts >= 10) {
          clearInterval(checkInterval);
          return res
            .status(500)
            .json({ error: "Timeout: La app se resiste a cerrar" });
        }
      },
    );
  }, 500);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`> Servidor PC activo en puerto ${PORT}`);
});
