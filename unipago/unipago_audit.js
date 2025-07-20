const { Client } = require('pg');

class UnipagoAuditLogger {
    constructor(config) {
        this.config = config.DATABASE;
        this.initDatabase();
    }

    async getConnection() {
        const client = new Client({
            host: this.config.host,
            port: parseInt(this.config.port),
            user: this.config.username,
            password: this.config.password,
            database: this.config.database
        });
        
        await client.connect();
        
        // Set schema if specified
        if (this.config.schema) {
            await client.query(`SET search_path TO ${this.config.schema}, public`);
        }
        
        return client;
    }

    async initDatabase() {
        let client;
        try {
            client = await this.getConnection();
            
            // Crear tabla de auditoría de importaciones
            await client.query(`
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
                )
            `);

            // Crear tabla de auditoría de afiliados
            await client.query(`
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
                )
            `);

            // Crear índices para mejor rendimiento
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_import_audit_timestamp 
                ON import_audit(timestamp)
            `);
            
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_affiliate_audit_document_id 
                ON affiliate_audit(document_id)
            `);

            logger.info('Tablas de auditoría PostgreSQL inicializadas correctamente');
        } catch (error) {
            logger.error(`Error inicializando base de datos de auditoría: ${error.message}`);
            throw error;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }

    async logImport(filename, fileHash, recordsProcessed, recordsSuccess, recordsFailed, processingTime, status, errorMessage = null) {
        let client;
        try {
            client = await this.getConnection();
            
            const result = await client.query(`
                INSERT INTO import_audit 
                (filename, file_hash, records_processed, records_success, records_failed,
                 processing_time_seconds, status, error_message)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `, [filename, fileHash, recordsProcessed, recordsSuccess, recordsFailed, processingTime, status, errorMessage]);

            logger.info(`Auditoría de importación registrada con ID: ${result.rows[0].id}`);
            return result.rows[0].id;
        } catch (error) {
            logger.error(`Error registrando auditoría de importación: ${error.message}`);
            throw error;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }

    async logAffiliateAction(affiliateId, documentId, action, sourceFile, status, details = null) {
        let client;
        try {
            client = await this.getConnection();
            
            const result = await client.query(`
                INSERT INTO affiliate_audit 
                (affiliate_id, document_id, action, source_file, status, details)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [affiliateId, documentId, action, sourceFile, status, details]);

            return result.rows[0].id;
        } catch (error) {
            logger.error(`Error registrando auditoría de afiliado: ${error.message}`);
            throw error;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }

    async getImportHistory(limit = 10) {
        let client;
        try {
            client = await this.getConnection();
            
            const result = await client.query(`
                SELECT * FROM import_audit 
                ORDER BY timestamp DESC 
                LIMIT $1
            `, [limit]);

            return result.rows;
        } catch (error) {
            logger.error(`Error obteniendo historial de importaciones: ${error.message}`);
            throw error;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }

    async getImportStats() {
        let client;
        try {
            client = await this.getConnection();
            
            const result = await client.query(`
                SELECT 
                    COUNT(*) as total_imports,
                    SUM(records_processed) as total_records_processed,
                    SUM(records_success) as total_records_success,
                    SUM(records_failed) as total_records_failed,
                    AVG(processing_time_seconds) as avg_processing_time,
                    COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_imports,
                    COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as failed_imports
                FROM import_audit
                WHERE timestamp >= NOW() - INTERVAL '30 days'
            `);

            return result.rows[0];
        } catch (error) {
            logger.error(`Error obteniendo estadísticas de importación: ${error.message}`);
            throw error;
        } finally {
            if (client) {
                await client.end();
            }
        }
    }
}

module.exports = UnipagoAuditLogger;