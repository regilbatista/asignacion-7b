const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const crypto = require('crypto');

class UnipagoImportManager {
    constructor() {
        this.setupLogger();
        this.monitoring = false;
        this.config = null;
        this.sftp = new SftpClient();
        this.dbClient = null;
        this.supportedSchemaVersions = ['1.0'];
    }

    setupLogger() {
        global.logger = {
            info: (msg) => console.log(`ℹ️  ${new Date().toISOString()} [INFO] ${msg}`),
            error: (msg) => console.error(`❌ ${new Date().toISOString()} [ERROR] ${msg}`),
            warning: (msg) => console.warn(`⚠️  ${new Date().toISOString()} [WARN] ${msg}`),
            warn: (msg) => console.warn(`⚠️  ${new Date().toISOString()} [WARN] ${msg}`)
        };
    }

    async initialize() {
        try {
            logger.info('🔧 Inicializando Unipago Import Manager JSON...');
            
            this.config = {
                DATABASE: {
                    host: process.env.DB_HOST || 'postgres_unipago',
                    port: 5432,
                    database: 'unipago_main',
                    username: 'unipago_user',
                    password: 'secure_password',
                    schema: 'payments'
                },
                SFTP: {
                    host: process.env.SFTP_HOST || 'sftp_server',
                    port: 22,
                    username: 'unipago_import',
                    password: 'import_password',
                    remoteDir: '/upload/afiliaciones',
                    processedDir: '/upload/processed',
                    tempDir: '/app/temp'
                },
                PROCESSING: {
                    monitor_interval: 30000,
                    batch_size: 1000,
                    supported_formats: ['json'],
                    validate_schema: true
                }
            };

            // Crear directorio temporal
            if (!fs.existsSync(this.config.SFTP.tempDir)) {
                fs.mkdirSync(this.config.SFTP.tempDir, { recursive: true });
            }

            await this.initializeDatabase();
            
            logger.info('✅ Unipago Import Manager JSON inicializado correctamente');
            return true;
        } catch (error) {
            logger.error(`Error inicializando Unipago Import Manager: ${error.message}`);
            throw error;
        }
    }

    async initializeDatabase() {
        try {
            this.dbClient = new Client({
                host: this.config.DATABASE.host,
                port: this.config.DATABASE.port,
                user: this.config.DATABASE.username,
                password: this.config.DATABASE.password,
                database: this.config.DATABASE.database
            });

            await this.dbClient.connect();
            await this.dbClient.query(`SET search_path TO ${this.config.DATABASE.schema}, public`);
            
            logger.info('✅ Conexión a PostgreSQL establecida');
        } catch (error) {
            logger.error(`Error conectando a PostgreSQL: ${error.message}`);
            throw error;
        }
    }

    async connectSFTP() {
        try {
            await this.sftp.connect({
                host: this.config.SFTP.host,
                port: this.config.SFTP.port,
                username: this.config.SFTP.username,
                password: this.config.SFTP.password
            });
            logger.info('✅ Conexión SFTP establecida');
            return true;
        } catch (error) {
            logger.error(`Error conectando a SFTP: ${error.message}`);
            return false;
        }
    }

    async scanForFiles() {
        try {
            const files = await this.sftp.list(this.config.SFTP.remoteDir);
            const jsonFiles = files.filter(file => 
                file.type === '-' && 
                file.name.endsWith('.json') && 
                file.name.startsWith('ARS_AFILIACIONES')
            );

            if (jsonFiles.length > 0) {
                logger.info(`📁 Encontrados ${jsonFiles.length} archivos JSON para procesar`);
                return jsonFiles.map(file => ({
                    name: file.name,
                    size: file.size,
                    modifyTime: file.modifyTime
                }));
            } else {
                logger.info('📁 No se encontraron archivos JSON nuevos para procesar');
                return [];
            }
        } catch (error) {
            logger.error(`Error escaneando archivos SFTP: ${error.message}`);
            return [];
        }
    }

    async downloadFile(fileName) {
        try {
            const remotePath = `${this.config.SFTP.remoteDir}/${fileName}`;
            const localPath = path.join(this.config.SFTP.tempDir, fileName);

            await this.sftp.fastGet(remotePath, localPath);
            logger.info(`📥 Archivo JSON descargado: ${fileName}`);
            
            return localPath;
        } catch (error) {
            logger.error(`Error descargando archivo ${fileName}: ${error.message}`);
            throw error;
        }
    }

    validateJsonSchema(jsonData) {
        const errors = [];
        
        // Validar estructura principal
        if (!jsonData.export_info) {
            errors.push("Falta export_info");
        } else {
            if (!jsonData.export_info.timestamp) errors.push("Falta timestamp en export_info");
            if (!jsonData.export_info.source_system) errors.push("Falta source_system en export_info");
            if (!jsonData.export_info.schema_version) errors.push("Falta schema_version en export_info");
            
            // Verificar versión de esquema compatible
            if (jsonData.export_info.schema_version && 
                !this.supportedSchemaVersions.includes(jsonData.export_info.schema_version)) {
                errors.push(`Versión de esquema no soportada: ${jsonData.export_info.schema_version}`);
            }
        }
        
        // Validar array de afiliados
        if (!jsonData.affiliates || !Array.isArray(jsonData.affiliates)) {
            errors.push("Falta array de affiliates o no es válido");
        } else {
            // Validar estructura de cada afiliado
            jsonData.affiliates.forEach((affiliate, index) => {
                if (!affiliate.id) errors.push(`Afiliado ${index}: Falta id`);
                
                if (!affiliate.personal) {
                    errors.push(`Afiliado ${index}: Falta información personal`);
                } else {
                    if (!affiliate.personal.cedula) errors.push(`Afiliado ${index}: Falta cédula`);
                    if (!affiliate.personal.full_name) errors.push(`Afiliado ${index}: Falta nombre completo`);
                    if (!affiliate.personal.full_name?.first) errors.push(`Afiliado ${index}: Falta nombre`);
                    if (!affiliate.personal.full_name?.last) errors.push(`Afiliado ${index}: Falta apellido`);
                }
                
                if (!affiliate.plan) {
                    errors.push(`Afiliado ${index}: Falta información del plan`);
                } else {
                    if (!affiliate.plan.code) errors.push(`Afiliado ${index}: Falta código del plan`);
                    if (!affiliate.plan.name) errors.push(`Afiliado ${index}: Falta nombre del plan`);
                    if (typeof affiliate.plan.monthly_amount !== 'number') {
                        errors.push(`Afiliado ${index}: Monto mensual debe ser numérico`);
                    }
                }
            });
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    async parseJsonFile(filePath) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const jsonData = JSON.parse(fileContent);
            
            // Validar esquema
            const validation = this.validateJsonSchema(jsonData);
            if (!validation.isValid) {
                throw new Error(`Validación de esquema falló: ${validation.errors.join(', ')}`);
            }
            
            // Verificar checksum si está presente
            if (jsonData.export_info.data_checksum) {
                const contentString = JSON.stringify(jsonData.affiliates);
                const calculatedChecksum = crypto.createHash('md5').update(contentString).digest('hex');
                
                if (calculatedChecksum !== jsonData.export_info.data_checksum) {
                    throw new Error('Checksum de datos no coincide - archivo posiblemente corrupto');
                }
            }
            
            logger.info(`📊 JSON válido: ${jsonData.affiliates.length} afiliados, esquema v${jsonData.export_info.schema_version}`);
            
            return {
                metadata: jsonData.export_info,
                summary: jsonData.data_summary,
                affiliates: jsonData.affiliates,
                validation: validation
            };
        } catch (error) {
            logger.error(`Error parseando JSON: ${error.message}`);
            throw error;
        }
    }

    transformJsonToDatabase(affiliate) {
        return {
            external_id: affiliate.id,
            document_id: affiliate.personal.cedula,
            first_name: affiliate.personal.full_name.first,
            last_name: affiliate.personal.full_name.last,
            birth_date: affiliate.personal.birth_date || null,
            gender: affiliate.personal.gender || null,
            phone: affiliate.contact?.phone || null,
            email: affiliate.contact?.email || null,
            address: affiliate.address?.full_address || null,
            province: affiliate.address?.province || null,
            municipality: affiliate.address?.municipality || null,
            plan_code: affiliate.plan.code,
            plan_name: affiliate.plan.name,
            plan_type: affiliate.plan.type || null,
            monthly_amount: affiliate.plan.monthly_amount || 0,
            status: affiliate.status || 'ACTIVE',
            category: affiliate.category || 'TITULAR',
            employer: affiliate.employment?.employer || null,
            base_salary: affiliate.employment?.base_salary || null
        };
    }

    async insertAffiliates(affiliatesData, sourceFile, metadata) {
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        try {
            await this.dbClient.query('BEGIN');

            for (const affiliate of affiliatesData) {
                try {
                    const dbRecord = this.transformJsonToDatabase(affiliate);
                    
                    // Insertar o actualizar afiliado
                    const result = await this.dbClient.query(`
                        INSERT INTO affiliates (
                            external_id, document_id, first_name, last_name, 
                            birth_date, gender, phone, email, address, province, municipality,
                            plan_code, plan_name, plan_type, status, category, employer, base_salary,
                            source_system, created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (document_id) 
                        DO UPDATE SET 
                            external_id = EXCLUDED.external_id,
                            first_name = EXCLUDED.first_name,
                            last_name = EXCLUDED.last_name,
                            phone = EXCLUDED.phone,
                            email = EXCLUDED.email,
                            address = EXCLUDED.address,
                            province = EXCLUDED.province,
                            municipality = EXCLUDED.municipality,
                            plan_code = EXCLUDED.plan_code,
                            plan_name = EXCLUDED.plan_name,
                            plan_type = EXCLUDED.plan_type,
                            status = EXCLUDED.status,
                            category = EXCLUDED.category,
                            employer = EXCLUDED.employer,
                            base_salary = EXCLUDED.base_salary,
                            updated_at = CURRENT_TIMESTAMP
                        RETURNING id
                    `, [
                        dbRecord.external_id, dbRecord.document_id, dbRecord.first_name, 
                        dbRecord.last_name, dbRecord.birth_date, dbRecord.gender, 
                        dbRecord.phone, dbRecord.email, dbRecord.address, dbRecord.province,
                        dbRecord.municipality, dbRecord.plan_code, dbRecord.plan_name, 
                        dbRecord.plan_type, dbRecord.status, dbRecord.category,
                        dbRecord.employer, dbRecord.base_salary, metadata.source_system
                    ]);

                    const affiliateId = result.rows[0].id;

                    // Crear registro de pago si tiene monto
                    if (dbRecord.monthly_amount && dbRecord.monthly_amount > 0) {
                        // CORREGIDO: Usar INSERT simple sin ON CONFLICT para payment_records
                        await this.dbClient.query(`
                            INSERT INTO payment_records (
                                affiliate_id, plan_code, plan_name, monthly_amount, 
                                payment_frequency, status, source_file, created_at
                            ) VALUES ($1, $2, $3, $4, 'MONTHLY', 'PENDING', $5, CURRENT_TIMESTAMP)
                        `, [
                            affiliateId, dbRecord.plan_code, dbRecord.plan_name, 
                            dbRecord.monthly_amount, sourceFile
                        ]);
                    }

                    successCount++;
                } catch (error) {
                    errorCount++;
                    errors.push(`Error insertando ${affiliate.personal?.cedula}: ${error.message}`);
                    logger.error(`Error insertando afiliado ${affiliate.personal?.cedula}: ${error.message}`);
                }
            }

            await this.dbClient.query('COMMIT');
            logger.info(`✅ Transacción completada: ${successCount} éxitos, ${errorCount} errores`);

        } catch (error) {
            await this.dbClient.query('ROLLBACK');
            logger.error(`Error en transacción: ${error.message}`);
            throw error;
        }

        return { successCount, errorCount, errors };
    }

    async logImportAudit(filename, fileHash, recordsProcessed, recordsSuccess, recordsFailed, processingTime, status, errorMessage = null, metadata = null) {
        try {
            await this.dbClient.query(`
                INSERT INTO import_audit 
                (filename, file_hash, records_processed, records_success, records_failed,
                 processing_time_seconds, status, error_message, timestamp)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            `, [filename, fileHash, recordsProcessed, recordsSuccess, recordsFailed, processingTime, status, errorMessage]);
            
            logger.info(`📝 Auditoría JSON registrada: ${filename} (${recordsSuccess}/${recordsProcessed} registros)`);
        } catch (error) {
            logger.error(`Error registrando auditoría: ${error.message}`);
        }
    }

    async moveProcessedFile(fileName) {
        try {
            const sourcePath = `${this.config.SFTP.remoteDir}/${fileName}`;
            const destPath = `${this.config.SFTP.processedDir}/${fileName}`;
            
            // Crear directorio processed si no existe
            try {
                await this.sftp.mkdir(this.config.SFTP.processedDir, true);
            } catch (error) {
                // Ignorar si ya existe
            }

            await this.sftp.rename(sourcePath, destPath);
            logger.info(`📦 Archivo JSON movido a procesados: ${fileName}`);
        } catch (error) {
            logger.error(`Error moviendo archivo procesado: ${error.message}`);
        }
    }

    async processFile(file) {
        const startTime = new Date();
        let localPath = null;
        
        try {
            logger.info(`🔄 Procesando archivo JSON: ${file.name}`);
            
            // Descargar archivo
            localPath = await this.downloadFile(file.name);
            
            // Calcular hash del archivo
            const fileContent = fs.readFileSync(localPath);
            const fileHash = crypto.createHash('md5').update(fileContent).digest('hex');
            
            // Parsear JSON
            const { metadata, affiliates, validation } = await this.parseJsonFile(localPath);
            
            logger.info(`📊 Datos JSON procesados: ${affiliates.length} afiliados del sistema ${metadata.source_system}`);
            
            // Insertar en base de datos
            const { successCount, errorCount, errors } = await this.insertAffiliates(affiliates, file.name, metadata);
            
            const processingTime = (new Date() - startTime) / 1000;
            const status = errorCount === 0 ? 'SUCCESS' : 'PARTIAL';
            
            // Registrar auditoría
            await this.logImportAudit(
                file.name, 
                fileHash, 
                affiliates.length, 
                successCount, 
                errorCount, 
                processingTime, 
                status,
                errors.length > 0 ? errors.slice(0, 3).join('; ') : null,
                metadata
            );
            
            // Mover archivo a procesados
            await this.moveProcessedFile(file.name);
            
            logger.info(`✅ Archivo JSON ${file.name} procesado: ${successCount}/${affiliates.length} registros en ${processingTime}s`);
            
            return { success: true, processed: successCount, errors: errorCount, metadata };
            
        } catch (error) {
            const processingTime = (new Date() - startTime) / 1000;
            
            await this.logImportAudit(
                file.name, 
                'error', 
                0, 
                0, 
                0, 
                processingTime, 
                'ERROR',
                error.message
            );
            
            logger.error(`❌ Error procesando archivo JSON ${file.name}: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            // Limpiar archivo temporal
            if (localPath && fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
            }
        }
    }

    async monitorAndProcess() {
        logger.info('👀 Iniciando monitoreo de archivos JSON SFTP...');
        
        const processFiles = async () => {
            try {
                // Conectar SFTP si es necesario
                if (!this.sftp.sftp) {
                    const connected = await this.connectSFTP();
                    if (!connected) {
                        logger.error('No se pudo conectar a SFTP, reintentando en el próximo ciclo');
                        return;
                    }
                }

                // Escanear archivos JSON
                const files = await this.scanForFiles();
                
                if (files.length > 0) {
                    for (const file of files) {
                        await this.processFile(file);
                    }
                } else {
                    logger.info('📁 No hay archivos JSON nuevos para procesar');
                }
                
            } catch (error) {
                logger.error(`Error en ciclo de monitoreo: ${error.message}`);
                
                // Reconectar SFTP si hay error
                try {
                    await this.sftp.end();
                } catch (e) {
                    // Ignorar errores de desconexión
                }
            }
        };

        // Ejecutar inmediatamente
        await processFiles();
        
        // Programar ejecuciones periódicas
        const monitorInterval = setInterval(processFiles, this.config.PROCESSING.monitor_interval);
        
        this.monitoring = true;
        return monitorInterval;
    }

    async getStatistics() {
        try {
            const result = await this.dbClient.query(`
                SELECT 
                    COUNT(*) as total_affiliates,
                    COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END) as active_affiliates,
                    COUNT(DISTINCT plan_code) as unique_plans,
                    MAX(updated_at) as last_update
                FROM affiliates
            `);
            
            const auditResult = await this.dbClient.query(`
                SELECT 
                    COUNT(*) as total_imports,
                    SUM(records_processed) as total_records_processed,
                    SUM(records_success) as total_records_success,
                    COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_imports,
                    MAX(timestamp) as last_import
                FROM import_audit
                WHERE timestamp >= NOW() - INTERVAL '24 hours'
            `);
            
            const stats = {
                ...result.rows[0],
                ...auditResult.rows[0]
            };
            
            logger.info(`📊 Estadísticas JSON: ${stats.total_affiliates} afiliados, ${stats.total_imports} importaciones hoy`);
            return stats;
        } catch (error) {
            logger.error(`Error obteniendo estadísticas: ${error.message}`);
            return null;
        }
    }

    async start() {
        try {
            logger.info('🌟 Iniciando Unipago Importer con procesamiento JSON...');
            
            await this.initialize();
            await this.monitorAndProcess();
            
            // Mostrar estadísticas cada 5 minutos
            setInterval(async () => {
                await this.getStatistics();
            }, 300000);
            
            // Heartbeat
            setInterval(() => {
                logger.info(`💓 Unipago Importer JSON activo - ${new Date().toISOString()}`);
            }, 60000); // Cada minuto
            
        } catch (error) {
            logger.error(`Error fatal iniciando Unipago Importer: ${error.message}`);
            process.exit(1);
        }
    }

    async cleanup() {
        try {
            if (this.sftp.sftp) {
                await this.sftp.end();
            }
            if (this.dbClient) {
                await this.dbClient.end();
            }
            logger.info('🧹 Limpieza completada');
        } catch (error) {
            logger.error(`Error en limpieza: ${error.message}`);
        }
    }
}

// Main function to start the Unipago Importer

async function main() {
    const manager = new UnipagoImportManager();
    
    // Manejar señales de cierre
    const gracefulShutdown = async (signal) => {
        logger.info(`🛑 Unipago Importer cerrando por ${signal}...`);
        await manager.cleanup();
        process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Manejar errores no capturados
    process.on('uncaughtException', async (error) => {
        console.error('💥 Error no capturado:', error);
        await manager.cleanup();
        process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
        console.error('🚫 Promesa rechazada no manejada:', reason);
        await manager.cleanup();
        process.exit(1);
    });

    // Iniciar el manager
    await manager.start();
}

// Ejecutar la aplicación
if (require.main === module) {
    console.log('🎯 Iniciando Unipago Importer JSON Application...');
    main();
} else {
    module.exports = UnipagoImportManager;
}