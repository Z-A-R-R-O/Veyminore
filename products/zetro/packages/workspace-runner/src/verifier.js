const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const execFileAsync = promisify(execFile);

const isWin = os.platform() === 'win32';

/**
 * Resolves the absolute path to npm-cli.js across diverse Windows layouts
 * (colocated, APPDATA, Program Files, PATH directories, or explicit override).
 * Returns null if unresolvable.
 */
function resolveNpmCliPath(overridePath = null) {
    if (overridePath) {
        try {
            const resolved = path.resolve(overridePath);
            if (fs.existsSync(resolved)) return resolved;
        } catch {}
    }
    if (process.env.NPM_CLI_PATH) {
        try {
            const resolved = path.resolve(process.env.NPM_CLI_PATH);
            if (fs.existsSync(resolved)) return resolved;
        } catch {}
    }
    const candidates = [
        path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    if (process.env.PATH) {
        for (const dir of process.env.PATH.split(path.delimiter)) {
            if (!dir) continue;
            candidates.push(path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
            candidates.push(path.join(dir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
            candidates.push(path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
        }
    }
    for (const c of candidates) {
        try {
            if (fs.existsSync(c)) return path.resolve(c);
        } catch {}
    }
    return null;
}

const defaultCliPath = isWin ? resolveNpmCliPath() : null;
const defaultNpmCmd = isWin ? process.execPath : 'npm';
const defaultNpmArgs = isWin ? (defaultCliPath ? [defaultCliPath] : []) : [];

// Finite check IDs to fixed execFile argv
const ALLOWED_CHECKS = {
    'npm-test': [defaultNpmCmd, [...defaultNpmArgs, 'test']],
    'npm-lint': [defaultNpmCmd, [...defaultNpmArgs, 'run', 'lint']],
    'tsc-check': [process.execPath, ['./node_modules/typescript/bin/tsc', '--noEmit']]
};

class Verifier {
    constructor(basePath, allowedPaths = [], options = {}) {
        if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
            throw new Error('Explicit non-empty allowedPaths is required');
        }
        this.basePath = path.resolve(basePath);
        this.rawAllowedPaths = allowedPaths;
        this.resolvedAllowedPaths = null;
        this.options = options || {};
    }

    async init() {
        try {
            this.basePath = await fs.promises.realpath(this.basePath);
        } catch (e) {
            // Keep resolved basePath if realpath unavailable
        }
        // Resolve realpaths of allowed roots to prevent bypass
        const paths = [];
        for (const p of this.rawAllowedPaths) {
            const resolved = path.resolve(this.basePath, p);
            try {
                const real = await fs.promises.realpath(resolved);
                paths.push(real);
            } catch (e) {
                paths.push(resolved);
            }
        }
        this.resolvedAllowedPaths = paths;
    }

    async isPathAllowed(targetPath) {
        if (!this.resolvedAllowedPaths) await this.init();

        const resolved = path.resolve(this.basePath, targetPath);
        
        if (!resolved.startsWith(this.basePath + path.sep) && resolved !== this.basePath) {
            return false;
        }

        let real;
        try {
            real = await fs.promises.realpath(resolved);
        } catch (e) {
            try {
                const parentReal = await fs.promises.realpath(path.dirname(resolved));
                real = path.join(parentReal, path.basename(resolved));
            } catch (err) {
                return false;
            }
        }

        if (!real.startsWith(this.basePath + path.sep) && real !== this.basePath) {
            return false;
        }

        return this.resolvedAllowedPaths.some(allowed => 
            real.startsWith(allowed + path.sep) || real === allowed
        );
    }

    async runCheck(checkId, options = {}) {
        if (!ALLOWED_CHECKS[checkId] && !['npm-test', 'npm-lint', 'tsc-check'].includes(checkId)) {
            return { success: false, error: 'Command not in allowlist', code: -1 };
        }
        
        let cmd, args;
        if (checkId === 'npm-test' || checkId === 'npm-lint') {
            const subArgs = checkId === 'npm-test' ? ['test'] : ['run', 'lint'];
            if (isWin) {
                const cliPath = resolveNpmCliPath(options.npmCliPath || this.options.npmCliPath);
                if (!cliPath) {
                    return {
                        success: false,
                        error: 'npm CLI script (npm-cli.js) could not be resolved on Windows without shell:true. Spawning npm.cmd with shell:false is rejected to prevent spawn EINVAL.',
                        code: -1
                    };
                }
                cmd = process.execPath;
                args = [cliPath, ...subArgs];
            } else {
                cmd = 'npm';
                args = subArgs;
            }
        } else if (checkId === 'tsc-check') {
            cmd = process.execPath;
            args = ['./node_modules/typescript/bin/tsc', '--noEmit'];
        } else {
            [cmd, args] = ALLOWED_CHECKS[checkId];
        }

        const { timeout = 5000, maxBuffer = 1024 * 1024 } = options;
        
        try {
            const { stdout, stderr } = await execFileAsync(cmd, args, {
                cwd: this.basePath,
                timeout,
                maxBuffer,
                shell: false,
            });
            return { 
                success: true, 
                stdout: stdout.substring(0, 1000), 
                stderr: stderr.substring(0, 1000), 
                code: 0 
            };
        } catch (error) {
            return {
                success: false,
                stdout: (error.stdout || '').substring(0, 1000),
                stderr: (error.stderr || '').substring(0, 1000),
                code: error.code || 1,
                killed: error.killed || false
            };
        }
    }

    async getGitMetadata() {
        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.basePath });
            if (stdout.trim() !== 'true') throw new Error('Not inside git');
            
            const [status, head] = await Promise.all([
                execFileAsync('git', ['status', '--porcelain'], { cwd: this.basePath }),
                execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.basePath })
            ]);
            return {
                isGit: true,
                changedFiles: status.stdout.split('\n').filter(Boolean),
                headHash: head.stdout.trim()
            };
        } catch (e) {
            return {
                isGit: false,
                message: 'Comprehensive inventory unavailable: Not a Git repository or git missing'
            };
        }
    }

    async generateReceipt(filesToCheck = []) {
        const receipt = {
            timestamp: new Date().toISOString(),
            files: {},
            git: await this.getGitMetadata()
        };

        for (const file of filesToCheck) {
            const allowed = await this.isPathAllowed(file);
            if (!allowed) {
                receipt.files[file] = { error: 'Path not allowed or escape attempted' };
                continue;
            }
            try {
                const fullPath = path.resolve(this.basePath, file);
                const stat = await fs.promises.stat(fullPath);
                
                const hash = crypto.createHash('sha256');
                const stream = fs.createReadStream(fullPath);
                
                await new Promise((resolve, reject) => {
                    stream.on('data', chunk => hash.update(chunk));
                    stream.on('end', resolve);
                    stream.on('error', reject);
                });
                
                receipt.files[file] = { hash: hash.digest('hex'), size: stat.size };
            } catch (err) {
                receipt.files[file] = { error: err.message };
            }
        }
        return receipt;
    }
}

module.exports = { Verifier, ALLOWED_CHECKS, resolveNpmCliPath };
