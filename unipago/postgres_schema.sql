-- Crear esquema para pagos
CREATE SCHEMA IF NOT EXISTS payments;
SET search_path TO payments, public;

-- Tabla de afiliados importados
CREATE TABLE IF NOT EXISTS affiliates (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(50) UNIQUE,
    document_id VARCHAR(20) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    birth_date DATE,
    gender VARCHAR(1),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    province VARCHAR(100),
    municipality VARCHAR(100),
    plan_code VARCHAR(50),
    plan_name VARCHAR(100),
    plan_type VARCHAR(50),
    affiliation_date DATE,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    category VARCHAR(20) DEFAULT 'TITULAR',
    employer VARCHAR(200),
    base_salary DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source_system VARCHAR(50) DEFAULT 'ARS_HUMANO'
);

-- Tabla de registros de pagos
CREATE TABLE IF NOT EXISTS payment_records (
    id SERIAL PRIMARY KEY,
    affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
    plan_code VARCHAR(50),
    plan_name VARCHAR(100),
    monthly_amount DECIMAL(10,2),
    payment_frequency VARCHAR(20) DEFAULT 'MONTHLY',
    status VARCHAR(20) DEFAULT 'PENDING',
    start_date DATE DEFAULT CURRENT_DATE,
    next_payment_date DATE,
    last_payment_date DATE,
    total_payments INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source_file VARCHAR(255)
);

-- Tabla de auditoría de importaciones
CREATE TABLE IF NOT EXISTS import_audit (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    filename VARCHAR(255),
    file_hash VARCHAR(255),
    records_processed INTEGER,
    records_success INTEGER,
    records_failed INTEGER,
    processing_time_seconds DECIMAL(10,3),
    status VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de auditoría de afiliados
CREATE TABLE IF NOT EXISTS affiliate_audit (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    affiliate_id INTEGER,
    document_id VARCHAR(20),
    action VARCHAR(50),
    source_file VARCHAR(255),
    status VARCHAR(50),
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de configuración del sistema
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de archivos procesados (para evitar duplicados)
CREATE TABLE IF NOT EXISTS processed_files (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) UNIQUE NOT NULL,
    file_hash VARCHAR(255),
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    records_count INTEGER,
    status VARCHAR(50) DEFAULT 'PROCESSED'
);

-- Índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_affiliates_document_id ON affiliates(document_id);
CREATE INDEX IF NOT EXISTS idx_affiliates_status ON affiliates(status);
CREATE INDEX IF NOT EXISTS idx_affiliates_plan_code ON affiliates(plan_code);
CREATE INDEX IF NOT EXISTS idx_affiliates_created_at ON affiliates(created_at);

CREATE INDEX IF NOT EXISTS idx_payment_records_affiliate_id ON payment_records(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON payment_records(status);
CREATE INDEX IF NOT EXISTS idx_payment_records_next_payment ON payment_records(next_payment_date);

CREATE INDEX IF NOT EXISTS idx_import_audit_timestamp ON import_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_import_audit_status ON import_audit(status);

CREATE INDEX IF NOT EXISTS idx_affiliate_audit_document_id ON affiliate_audit(document_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_audit_timestamp ON affiliate_audit(timestamp);

CREATE INDEX IF NOT EXISTS idx_processed_files_filename ON processed_files(filename);
CREATE INDEX IF NOT EXISTS idx_processed_files_hash ON processed_files(file_hash);

-- Función para actualizar timestamp automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para actualizar updated_at automáticamente
CREATE TRIGGER update_affiliates_updated_at BEFORE UPDATE ON affiliates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_records_updated_at BEFORE UPDATE ON payment_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_import_audit_updated_at BEFORE UPDATE ON import_audit
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_affiliate_audit_updated_at BEFORE UPDATE ON affiliate_audit
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insertar configuración del sistema
INSERT INTO system_config (config_key, config_value, description) VALUES
('monitor_interval', '30000', 'Intervalo de monitoreo en milisegundos'),
('batch_size', '1000', 'Tamaño de lote para procesamiento'),
('max_file_age_hours', '24', 'Edad máxima de archivos en horas'),
('retention_days', '30', 'Días de retención de archivos'),
('notification_enabled', 'false', 'Habilitar notificaciones por email'),
('auto_approve_payments', 'false', 'Aprobar pagos automáticamente')
ON CONFLICT (config_key) DO UPDATE SET 
    config_value = EXCLUDED.config_value,
    description = EXCLUDED.description;