-- Crear base de datos ARS
CREATE DATABASE IF NOT EXISTS ars_humano;
USE ars_humano;

-- Tabla de planes
CREATE TABLE IF NOT EXISTS planes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_plan VARCHAR(50) UNIQUE NOT NULL,
    nombre_plan VARCHAR(100) NOT NULL,
    tipo_plan VARCHAR(50) NOT NULL,
    nivel INT DEFAULT 1,
    monto_mensual DECIMAL(10,2) DEFAULT 0.00,
    descripcion TEXT,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de afiliados
CREATE TABLE IF NOT EXISTS afiliados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_afiliado VARCHAR(50) UNIQUE NOT NULL,
    cedula VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    fecha_nacimiento DATE,
    sexo ENUM('M', 'F'),
    telefono VARCHAR(20),
    email VARCHAR(100),
    direccion TEXT,
    provincia VARCHAR(100),
    municipio VARCHAR(100),
    plan_id INT,
    fecha_afiliacion DATE DEFAULT (CURRENT_DATE),
    fecha_ultima_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    estado ENUM('ACTIVO', 'INACTIVO', 'SUSPENDIDO') DEFAULT 'ACTIVO',
    categoria_afiliado ENUM('TITULAR', 'DEPENDIENTE') DEFAULT 'TITULAR',
    empresa_empleadora VARCHAR(200),
    salario_base DECIMAL(10,2),
    es_datos_prueba BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES planes(id) ON DELETE SET NULL
);

-- Tabla de auditoría de exportaciones
CREATE TABLE IF NOT EXISTS export_audit (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    filename VARCHAR(255),
    records_exported INT,
    file_size_bytes BIGINT,
    file_hash VARCHAR(255),
    ftp_upload_status VARCHAR(50),
    error_message TEXT,
    execution_time_seconds DECIMAL(10,3),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de configuración del sistema
CREATE TABLE IF NOT EXISTS system_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Índices para optimizar consultas
CREATE INDEX idx_afiliados_cedula ON afiliados(cedula);
CREATE INDEX idx_afiliados_estado ON afiliados(estado);
CREATE INDEX idx_afiliados_plan ON afiliados(plan_id);
CREATE INDEX idx_afiliados_fecha_mod ON afiliados(fecha_ultima_modificacion);
CREATE INDEX idx_export_audit_timestamp ON export_audit(timestamp);
CREATE INDEX idx_export_audit_status ON export_audit(ftp_upload_status);

-- Insertar datos de ejemplo de planes
INSERT INTO planes (codigo_plan, nombre_plan, tipo_plan, nivel, monto_mensual, descripcion) VALUES
('BASICO', 'Plan Básico', 'INDIVIDUAL', 1, 1500.00, 'Cobertura básica de salud'),
('FAMILIAR', 'Plan Familiar', 'FAMILIAR', 2, 2500.00, 'Cobertura familiar completa'),
('PREMIUM', 'Plan Premium', 'INDIVIDUAL', 3, 4000.00, 'Cobertura premium con beneficios adicionales'),
('EJECUTIVO', 'Plan Ejecutivo', 'CORPORATIVO', 4, 6000.00, 'Plan empresarial de alta gama'),
('ESTUDIANTIL', 'Plan Estudiantil', 'INDIVIDUAL', 1, 1200.00, 'Plan especial para estudiantes')
ON DUPLICATE KEY UPDATE 
    nombre_plan = VALUES(nombre_plan),
    monto_mensual = VALUES(monto_mensual),
    descripcion = VALUES(descripcion);

-- Insertar datos de ejemplo de afiliados
INSERT INTO afiliados (numero_afiliado, cedula, nombre, apellido, fecha_nacimiento, sexo, telefono, email, provincia, municipio, plan_id, categoria_afiliado, empresa_empleadora, salario_base) VALUES
('ARS001', '001-1234567-1', 'Juan Carlos', 'Pérez García', '1985-03-15', 'M', '809-555-0001', 'juan.perez@email.com', 'Santo Domingo', 'Santo Domingo Este', 1, 'TITULAR', 'Empresa ABC', 45000.00),
('ARS002', '001-2345678-2', 'María Elena', 'González Rodríguez', '1990-07-22', 'F', '809-555-0002', 'maria.gonzalez@email.com', 'Santiago', 'Santiago', 2, 'TITULAR', 'Corporación XYZ', 55000.00),
('ARS003', '001-3456789-3', 'Carlos Alberto', 'Martínez López', '1982-11-08', 'M', '809-555-0003', 'carlos.martinez@email.com', 'Santo Domingo', 'Santo Domingo Norte', 3, 'TITULAR', 'Industrias DEF', 75000.00),
('ARS004', '001-4567890-4', 'Ana Patricia', 'Jiménez Herrera', '1988-05-30', 'F', '809-555-0004', 'ana.jimenez@email.com', 'La Vega', 'La Vega', 1, 'TITULAR', 'Servicios GHI', 40000.00),
('ARS005', '001-5678901-5', 'Luis Miguel', 'Sánchez Morales', '1975-12-12', 'M', '809-555-0005', 'luis.sanchez@email.com', 'San Pedro de Macorís', 'San Pedro de Macorís', 4, 'TITULAR', 'Consultora JKL', 85000.00),
('ARS006', '001-6789012-6', 'Carmen Rosa', 'Valdez Núñez', '1992-02-18', 'F', '809-555-0006', 'carmen.valdez@email.com', 'Puerto Plata', 'Puerto Plata', 2, 'TITULAR', 'Hotel MNO', 38000.00),
('ARS007', '001-7890123-7', 'Roberto José', 'Fernández Castro', '1980-09-25', 'M', '809-555-0007', 'roberto.fernandez@email.com', 'Barahona', 'Barahona', 3, 'TITULAR', 'Banco PQR', 95000.00),
('ARS008', '001-8901234-8', 'Yolanda María', 'Reyes Silvestre', '1995-06-14', 'F', '809-555-0008', 'yolanda.reyes@email.com', 'Moca', 'Moca', 5, 'TITULAR', 'Universidad STU', 25000.00)
ON DUPLICATE KEY UPDATE 
    nombre = VALUES(nombre),
    apellido = VALUES(apellido),
    telefono = VALUES(telefono),
    email = VALUES(email);

-- Insertar configuración del sistema
INSERT INTO system_config (config_key, config_value, description) VALUES
('export_schedule', '0 1 * * *', 'Horario de exportación automática'),
('batch_size', '5000', 'Tamaño de lote para exportaciones'),
('retention_days', '30', 'Días de retención de archivos'),
('notification_enabled', 'true', 'Habilitar notificaciones por email')
ON DUPLICATE KEY UPDATE 
    config_value = VALUES(config_value),
    description = VALUES(description);