const mysql = require('mysql2/promise');

class ARSAuditLogger {
    constructor(config) {
        this.config = config.DATABASE;
        this.initDatabase();
    }

    async getConnection() {
        return await mysql.createConnection({
            host: this.config.host,
            port: parseInt(this.config.port),
            user: this.config.username,
            password: this.config.password,
            database: this.config.database,
            charset: this.config.charset
        });
    }

    async initDatabase() {
        let connection;
        try {
            connection = await this.getConnection();
            
            // Crear tabla de auditoría de exportaciones
            await connection.execute(`
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
                )
            `);

            logger.info('Tabla de auditoría MySQL inicializada correctamente');
        } catch (error) {
            logger.error(`Error inicializando base de datos de auditoría: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }

    async logExport(filename, recordsExported, fileSize, fileHash, ftpStatus, errorMessage = null, executionTime = null) {
        let connection;
        try {
            connection = await this.getConnection();
            
            const [result] = await connection.execute(`
                INSERT INTO export_audit 
                (filename, records_exported, file_size_bytes, file_hash, 
                 ftp_upload_status, error_message, execution_time_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [filename, recordsExported, fileSize, fileHash, ftpStatus, errorMessage, executionTime]);

            logger.info(`Auditoría registrada con ID: ${result.insertId}`);
            return result.insertId;
        } catch (error) {
            logger.error(`Error registrando auditoría: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }

    async getExportHistory(limit = 10) {
        let connection;
        try {
            connection = await this.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT * FROM export_audit 
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [limit]);

            return rows;
        } catch (error) {
            logger.error(`Error obteniendo historial de exportaciones: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }

    async getExportStats() {
        let connection;
        try {
            connection = await this.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT 
                    COUNT(*) as total_exports,
                    SUM(records_exported) as total_records_exported,
                    AVG(execution_time_seconds) as avg_execution_time,
                    COUNT(CASE WHEN ftp_upload_status = 'SUCCESS' THEN 1 END) as successful_exports,
                    COUNT(CASE WHEN ftp_upload_status = 'ERROR' THEN 1 END) as failed_exports
                FROM export_audit
                WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `);

            return rows[0];
        } catch (error) {
            logger.error(`Error obteniendo estadísticas de exportación: ${error.message}`);
            throw error;
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    }
}

module.exports = ARSAuditLogger;