const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { log } = require("console");
const multer = require("multer");
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Configuración de Multer para guardar el archivo donde le digamos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // req.body.path contendrá la ruta actual donde estás en la app
    cb(null, req.body.path || "C:\\");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

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

// 4. DESCARGAR ARCHIVO (PC -> Móvil)
app.get("/files/download", (req, res) => {
  const targetPath = req.query.path;
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: "Archivo no encontrado" });
  }
  // res.download maneja la transmisión del archivo automáticamente
  res.download(targetPath);
});

// 5. SUBIR ARCHIVO (Móvil -> PC)
app.post("/files/upload", upload.array("files"), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No se recibieron archivos" });
  }

  // Aquí devolvemos la confirmación exacta de cuántos se subieron
  res.json({
    message: `¡${req.files.length} archivo(s) subido(s) correctamente al PC!`,
  });
});

// 6. LISTAR APPS ABIERTAS (Solo las que tienen ventana visible)
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

// 7. ABRIR APP CON CONFIRMACIÓN DE 5 SEGUNDOS
app.post("/apps/open", (req, res) => {
  const { appPath } = req.body;
  if (!appPath) return res.status(400).json({ error: "Ruta vacía" });

  console.log(`> Lanzando: ${appPath}`);

  // 1. Damos la orden de abrir
  const { exec } = require("child_process");
  const path = require("path");

  exec(`start "" "${appPath}"`, (startErr) => {
    if (startErr) console.error("Error al lanzar CMD:", startErr);
  });

  // 2. Extraemos el nombre del proceso
  const processName = path.basename(appPath, ".exe");

  // 3. Bucle de comprobación (Polling) OPTIMIZADO
  let attempts = 0;
  const maxAttempts = 5; // 5 intentos x 1000ms = 5 segundos

  let hasResponded = false;

  const checkInterval = setInterval(() => {
    attempts++;

    exec(
      `powershell -Command "Get-Process -Name '${processName}' -ErrorAction SilentlyContinue"`,
      (err, stdout) => {
        // Si ya respondimos antes, cortamos
        if (hasResponded) return;

        if (stdout.trim()) {
          // ¡Lo encontró!
          hasResponded = true;
          clearInterval(checkInterval);
          return res.json({
            message: `App ${processName} abierta y confirmada`,
          });
        }

        // Si llegamos a los 5 intentos (5 segundos)
        if (attempts >= maxAttempts) {
          hasResponded = true;
          clearInterval(checkInterval);
          return res
            .status(500)
            .json({ error: `Timeout: No se detectó ${processName} tras 5s` });
        }
      },
    );
  }, 1000); // <-- Comprobación cada 1000ms (1 segundo)
});

// 8. CERRAR APP CON CONFIRMACIÓN DE 5 SEGUNDOS
app.post("/apps/close", (req, res) => {
  const { pid } = req.body;

  if (!pid) return res.status(400).json({ error: "Falta el PID" });

  console.log(`> Cerrando PID: ${pid}`);
  const { exec } = require("child_process");

  // Lanzamos el comando para matar el proceso
  exec(`taskkill /F /PID ${pid}`, (err) => {
    if (err) console.error("Error en taskkill:", err);
  });

  let attempts = 0;
  const maxAttempts = 5; // 5 intentos x 1000ms = 5 segundos

  // ¡Nuestra bandera salvavidas!
  let hasResponded = false;

  const checkInterval = setInterval(() => {
    attempts++;

    // Preguntamos a PowerShell si el proceso AÚN existe
    exec(
      `powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue"`,
      (err, stdout) => {
        // Si ya respondimos a esta petición, ignoramos cualquier callback atrasado
        if (hasResponded) return;

        if (!stdout.trim()) {
          // Si no devuelve nada, es que el proceso ya murió (éxito)
          hasResponded = true;
          clearInterval(checkInterval);
          return res.json({ message: "App cerrada y confirmada" });
        }

        // Si llegamos al límite de intentos y sigue viva
        if (attempts >= maxAttempts) {
          hasResponded = true;
          clearInterval(checkInterval);
          return res
            .status(500)
            .json({ error: "Timeout: La app se resiste a cerrar" });
        }
      },
    );
  }, 1000); // <-- Cambiado a 1000ms (1 segundo)
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`> Servidor PC activo en puerto ${PORT}`);
});
