const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SftpClient = require('ssh2-sftp-client');

class ARSExportManager {
    constructor() {
        this.setupLogger();
        this.config = null;
        this.sftp = new SftpClient();
        this.dbConnection = null;
        this.schemaVersion = "1.0";
        this.exportVersion = "2.0";
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
            logger.info('🔧 Inicializando ARS Export Manager JSON...');
            
            this.config = {
                DATABASE: {
                    host: process.env.DB_HOST || 'mysql_ars',
                    port: 3306,
                    database: 'ars_humano',
                    username: 'ars_user',
                    password: 'secure_password',
                    charset: 'utf8mb4'
                },
                SFTP: {
                    host: process.env.SFTP_HOST || 'sftp_server',
                    port: 22,
                    username: 'ars_export',
                    password: 'export_password',
                    remoteDir: '/upload/afiliaciones',
                    tempDir: '/app/temp'
                },
                EXPORT: {
                    batch_size: 1000,
                    file_prefix: 'ARS_AFILIACIONES',
                    format: 'json',
                    compression: false
                }
            };

            // Crear directorio temporal
            if (!fs.existsSync(this.config.SFTP.tempDir)) {
                fs.mkdirSync(this.config.SFTP.tempDir, { recursive: true });
            }

            await this.initializeDatabase();
            
            logger.info('✅ ARS Export Manager JSON inicializado correctamente');
            return true;
        } catch (error) {
            logger.error(`Error inicializando ARS Export Manager: ${error.message}`);
            throw error;
        }
    }

    async initializeDatabase() {
        try {
            this.dbConnection = await mysql.createConnection({
                host: this.config.DATABASE.host,
                port: this.config.DATABASE.port,
                user: this.config.DATABASE.username,
                password: this.config.DATABASE.password,
                database: this.config.DATABASE.database,
                charset: this.config.DATABASE.charset
            });
            
            logger.info('✅ Conexión a MySQL establecida');
        } catch (error) {
            logger.error(`Error conectando a MySQL: ${error.message}`);
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

    async getAffiliatesData() {
        try {
            const [rows] = await this.dbConnection.execute(`
                SELECT 
                    a.numero_afiliado,
                    a.cedula,
                    a.nombre,
                    a.apellido,
                    DATE_FORMAT(a.fecha_nacimiento, '%Y-%m-%d') as fecha_nacimiento,
                    a.sexo,
                    a.telefono,
                    a.email,
                    a.direccion,
                    a.provincia,
                    a.municipio,
                    p.codigo_plan,
                    p.nombre_plan,
                    p.tipo_plan,
                    p.nivel as plan_nivel,
                    p.monto_mensual,
                    a.estado,
                    a.categoria_afiliado,
                    a.empresa_empleadora,
                    a.salario_base,
                    DATE_FORMAT(a.created_at, '%Y-%m-%dT%H:%i:%sZ') as fecha_creacion,
                    DATE_FORMAT(a.fecha_ultima_modificacion, '%Y-%m-%dT%H:%i:%sZ') as fecha_modificacion
                FROM afiliados a
                LEFT JOIN planes p ON a.plan_id = p.id
                WHERE a.estado = 'ACTIVO'
                ORDER BY a.id
            `);
            
            logger.info(`📊 Consultados ${rows.length} afiliados activos`);
            return rows;
        } catch (error) {
            logger.error(`Error consultando datos: ${error.message}`);
            throw error;
        }
    }

    transformToJsonStructure(rawData) {
        const affiliates = rawData.map(row => ({
            id: row.numero_afiliado,
            personal: {
                cedula: row.cedula,
                full_name: {
                    first: row.nombre,
                    last: row.apellido
                },
                birth_date: row.fecha_nacimiento,
                gender: row.sexo
            },
            contact: {
                phone: row.telefono || null,
                email: row.email || null
            },
            address: {
                full_address: row.direccion || null,
                province: row.provincia || null,
                municipality: row.municipio || null
            },
            plan: {
                code: row.codigo_plan,
                name: row.nombre_plan,
                type: row.tipo_plan,
                level: row.plan_nivel,
                monthly_amount: parseFloat(row.monto_mensual) || 0
            },
            employment: {
                employer: row.empresa_empleadora || null,
                base_salary: parseFloat(row.salario_base) || null
            },
            status: row.estado,
            category: row.categoria_afiliado,
            dates: {
                created: row.fecha_creacion,
                last_modified: row.fecha_modificacion
            }
        }));

        return affiliates;
    }

    generateJsonExport(affiliatesData) {
        const transformedData = this.transformToJsonStructure(affiliatesData);
        const timestamp = new Date().toISOString();
        
        const exportData = {
            export_info: {
                timestamp: timestamp,
                source_system: "ARS_HUMANO",
                export_version: this.exportVersion,
                schema_version: this.schemaVersion,
                total_records: transformedData.length,
                file_format: "json",
                exported_by: "ars_exporter_service"
            },
            data_summary: {
                total_affiliates: transformedData.length,
                active_plans: [...new Set(transformedData.map(a => a.plan.code))],
                provinces: [...new Set(transformedData.map(a => a.address.province).filter(Boolean))],
                export_filters: {
                    status: "ACTIVO",
                    include_inactive: false
                }
            },
            affiliates: transformedData
        };

        // Calcular checksum del contenido
        const contentString = JSON.stringify(exportData.affiliates);
        exportData.export_info.data_checksum = crypto.createHash('md5').update(contentString).digest('hex');
        
        return exportData;
    }

    validateJsonStructure(jsonData) {
        const errors = [];
        
        // Validar estructura principal
        if (!jsonData.export_info) errors.push("Missing export_info");
        if (!jsonData.affiliates || !Array.isArray(jsonData.affiliates)) {
            errors.push("Missing or invalid affiliates array");
        }
        
        // Validar afiliados
        jsonData.affiliates?.forEach((affiliate, index) => {
            if (!affiliate.id) errors.push(`Affiliate ${index}: Missing id`);
            if (!affiliate.personal?.cedula) errors.push(`Affiliate ${index}: Missing cedula`);
            if (!affiliate.personal?.full_name?.first) errors.push(`Affiliate ${index}: Missing first name`);
            if (!affiliate.plan?.code) errors.push(`Affiliate ${index}: Missing plan code`);
        });
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    async createExportFile(affiliatesData) {
        try {
            const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const fileName = `${this.config.EXPORT.file_prefix}_${timestamp}.json`;
            const localPath = path.join(this.config.SFTP.tempDir, fileName);
            
            // Generar estructura JSON
            const jsonData = this.generateJsonExport(affiliatesData);
            
            // Validar estructura
            const validation = this.validateJsonStructure(jsonData);
            if (!validation.isValid) {
                throw new Error(`Validación JSON falló: ${validation.errors.join(', ')}`);
            }
            
            // Convertir a JSON string con formato
            const jsonContent = JSON.stringify(jsonData, null, 2);
            
            // Escribir archivo
            fs.writeFileSync(localPath, jsonContent, 'utf8');
            
            // Calcular hash y tamaño
            const fileSize = fs.statSync(localPath).size;
            const fileHash = crypto.createHash('md5').update(jsonContent).digest('hex');
            
            logger.info(`📄 Archivo JSON generado: ${fileName} (${fileSize} bytes, ${affiliatesData.length} registros)`);
            
            return {
                fileName,
                localPath,
                fileSize,
                fileHash,
                recordCount: affiliatesData.length,
                format: 'json',
                validation: validation
            };
        } catch (error) {
            logger.error(`Error creando archivo JSON: ${error.message}`);
            throw error;
        }
    }

    async uploadToSFTP(fileInfo) {
        try {
            const remotePath = `${this.config.SFTP.remoteDir}/${fileInfo.fileName}`;
            
            // Crear directorio remoto si no existe
            try {
                await this.sftp.mkdir(this.config.SFTP.remoteDir, true);
            } catch (error) {
                // Ignorar si ya existe
            }
            
            // Subir archivo
            await this.sftp.fastPut(fileInfo.localPath, remotePath);
            
            logger.info(`📤 Archivo JSON subido a SFTP: ${fileInfo.fileName}`);
            return true;
        } catch (error) {
            logger.error(`Error subiendo archivo JSON a SFTP: ${error.message}`);
            return false;
        }
    }

    async logExportAudit(fileInfo, ftpStatus, errorMessage = null, executionTime = null) {
        try {
            await this.dbConnection.execute(`
                INSERT INTO export_audit 
                (filename, records_exported, file_size_bytes, file_hash, 
                 ftp_upload_status, error_message, execution_time_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                fileInfo.fileName, 
                fileInfo.recordCount, 
                fileInfo.fileSize, 
                fileInfo.fileHash,
                ftpStatus, 
                errorMessage, 
                executionTime
            ]);
            
            logger.info(`📝 Auditoría registrada para ${fileInfo.fileName} (JSON)`);
        } catch (error) {
            logger.error(`Error registrando auditoría: ${error.message}`);
        }
    }

    async runExport() {
        const startTime = new Date();
        let fileInfo = null;
        
        try {
            logger.info('🚀 Iniciando proceso de exportación ARS JSON');
            
            // Conectar SFTP
            const sftpConnected = await this.connectSFTP();
            if (!sftpConnected) {
                throw new Error('No se pudo conectar a SFTP');
            }
            
            // Obtener datos
            const affiliatesData = await this.getAffiliatesData();
            
            if (affiliatesData.length === 0) {
                logger.warning('⚠️ No hay datos para exportar');
                return { success: true, exported: 0 };
            }
            
            // Crear archivo JSON
            fileInfo = await this.createExportFile(affiliatesData);
            
            // Subir a SFTP
            const uploadSuccess = await this.uploadToSFTP(fileInfo);
            const ftpStatus = uploadSuccess ? 'SUCCESS' : 'ERROR';
            
            const executionTime = (new Date() - startTime) / 1000;
            
            // Registrar auditoría
            await this.logExportAudit(
                fileInfo,
                ftpStatus,
                uploadSuccess ? null : 'Error uploading JSON to SFTP',
                executionTime
            );
            
            if (uploadSuccess) {
                logger.info(`✅ Exportación JSON completada: ${fileInfo.fileName} (${fileInfo.recordCount} registros en ${executionTime}s)`);
            } else {
                logger.error(`❌ Error en subida SFTP para ${fileInfo.fileName}`);
            }
            
            return { 
                success: uploadSuccess, 
                exported: fileInfo.recordCount, 
                fileName: fileInfo.fileName,
                format: 'json',
                executionTime 
            };

        } catch (error) {
            const executionTime = (new Date() - startTime) / 1000;
            
            // Registrar auditoría de error
            if (fileInfo) {
                await this.logExportAudit(
                    fileInfo,
                    'ERROR',
                    error.message,
                    executionTime
                );
            }
            
            logger.error(`❌ Error en proceso de exportación JSON: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            // Limpiar archivo temporal
            if (fileInfo && fileInfo.localPath && fs.existsSync(fileInfo.localPath)) {
                fs.unlinkSync(fileInfo.localPath);
            }
            
            // Cerrar conexión SFTP
            try {
                await this.sftp.end();
            } catch (error) {
                // Ignorar errores de desconexión
            }
        }
    }

    async getExportStats() {
        try {
            const [rows] = await this.dbConnection.execute(`
                SELECT 
                    COUNT(*) as total_exports,
                    SUM(records_exported) as total_records_exported,
                    AVG(execution_time_seconds) as avg_execution_time,
                    COUNT(CASE WHEN ftp_upload_status = 'SUCCESS' THEN 1 END) as successful_exports,
                    COUNT(CASE WHEN ftp_upload_status = 'ERROR' THEN 1 END) as failed_exports,
                    MAX(timestamp) as last_export
                FROM export_audit
                WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            `);

            const stats = rows[0];
            logger.info(`📊 Estadísticas JSON 24h: ${stats.total_exports} exportaciones, ${stats.total_records_exported} registros`);
            return stats;
        } catch (error) {
            logger.error(`Error obteniendo estadísticas: ${error.message}`);
            return null;
        }
    }

    async startPeriodicExport() {
        logger.info('⏰ Iniciando exportación JSON periódica (cada 2 minutos para demo)');
        
        // Exportación inicial
        await this.runExport();
        
        // Programar exportaciones cada 2 minutos para demo
        const exportInterval = setInterval(async () => {
            try {
                await this.runExport();
            } catch (error) {
                logger.error(`Error en exportación programada: ${error.message}`);
            }
        }, 120000); // 2 minutos
        
        return exportInterval;
    }

    async testConnections() {
        logger.info('🔍 Probando conexiones ARS JSON...');
        
        try {
            // Probar MySQL
            const [rows] = await this.dbConnection.execute('SELECT COUNT(*) as count FROM afiliados');
            logger.info(`✅ MySQL: ${rows[0].count} afiliados en base de datos`);
            
            // Probar SFTP
            const sftpConnected = await this.connectSFTP();
            if (sftpConnected) {
                logger.info('✅ SFTP: Conexión establecida correctamente');
                await this.sftp.end();
            } else {
                logger.error('❌ SFTP: Error de conexión');
                return false;
            }
            
            logger.info('✅ Todas las conexiones ARS JSON funcionando');
            return true;
        } catch (error) {
            logger.error(`Error en conexiones ARS: ${error.message}`);
            return false;
        }
    }

    async start() {
        try {
            logger.info('🌟 Iniciando ARS Exporter con formato JSON...');
            
            await this.initialize();
            const connectionsOk = await this.testConnections();
            
            if (!connectionsOk) {
                throw new Error('Fallo en pruebas de conexión');
            }
            
            await this.startPeriodicExport();
            
            // Mostrar estadísticas cada 5 minutos
            setInterval(async () => {
                await this.getExportStats();
            }, 300000);
            
            // Heartbeat
            setInterval(() => {
                logger.info(`💓 ARS Exporter JSON activo - ${new Date().toISOString()}`);
            }, 60000); // Cada minuto
            
        } catch (error) {
            logger.error(`Error fatal iniciando ARS Exporter: ${error.message}`);
            process.exit(1);
        }
    }

    async cleanup() {
        try {
            if (this.sftp.sftp) {
                await this.sftp.end();
            }
            if (this.dbConnection) {
                await this.dbConnection.end();
            }
            logger.info('🧹 Limpieza completada');
        } catch (error) {
            logger.error(`Error en limpieza: ${error.message}`);
        }
    }
}

// ===== INICIALIZACIÓN Y EJECUCIÓN =====

async function main() {
    const manager = new ARSExportManager();
    
    // Manejar señales de cierre
    const gracefulShutdown = async (signal) => {
        logger.info(`🛑 ARS Exporter cerrando por ${signal}...`);
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
    console.log('🎯 Iniciando ARS Exporter JSON Application...');
    main();
} else {
    module.exports = ARSExportManager;
}