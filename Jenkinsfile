pipeline {
    agent {
        kubernetes {
            yaml readTrusted('jenkins/worker.yaml')
        }
    }

    parameters {
        choice(name: 'SERVICE_NAME', choices: ['frontend/client', 'gateway', 'backend-auth'], description: 'Chọn service cần build')
        string(name: 'DOCKERHUB_REPO', defaultValue: 'catarena', description: 'Tên repository trên DockerHub')
    }

    environment {
        IMAGE_TAG = "${env.BUILD_NUMBER}"
    }

    stages {
        stage('Checkout Code') {
            steps {
                checkout scm
            }
        }

        stage('Nodejs Audit & Unit Test') {
            steps {
                container('nodejs') {
                    script {
                        dir("${params.SERVICE_NAME}") {
                            echo "--- Đang chạy npm install cho ${params.SERVICE_NAME} ---"
                            sh 'npm install'
                            
                            echo "--- Đang chạy Security Audit ---"
                            sh 'npm audit --audit-level=high || true'
                            
                            echo "--- Đang chạy Unit Test ---"
                            sh 'npm test'
                        }
                    }
                }
            }
        }

        stage('Security Scan Source (Trivy)') {
            steps {
                script {
                    def servicePath = "${WORKSPACE}/${params.SERVICE_NAME}"
                    echo "--- Kiểm tra tồn tại thư mục ${servicePath} ---"
                    if (!fileExists(servicePath)) {
                        error "Thư mục ${servicePath} không tồn tại. Vui lòng kiểm tra lại tên service."
                    }
                }
                container('trivy') {
                    echo "--- Quét lỗ hổng hệ thống và thư viện ---"
                    sh "trivy fs --severity HIGH,CRITICAL ${params.SERVICE_NAME}"
                }
            }
        }

        // stage('Scan Source Code (SonarQube)') {
        //     steps {
                
        //     }
        // }

        stage('Build & Push with Kaniko') {
            steps {
                container('kaniko') {
                    // Thay 'dockerhub-auth' bằng ID chính xác của credential bạn tạo trong Jenkins
                    withCredentials([usernamePassword(credentialsId: 'dockerhub-cred', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')]) {
                        script {
                           sh '''
                            mkdir -p /kaniko/.docker
                            
                            AUTH=$(echo -n "$DOCKER_USER:$DOCKER_PASS" | base64 | tr -d '\\n')
                            
                            printf '{"auths":{"https://index.docker.io/v1/":{"auth":"%s"}}}' "$AUTH" > /kaniko/.docker/config.json
                            
                            /kaniko/executor \
                                --context $WORKSPACE/${params.SERVICE_NAME}/client \
                                --dockerfile $WORKSPACE/${params.SERVICE_NAME}/client/Dockerfile \
                                --destination $DOCKERHUB_REPO/${params.SERVICE_NAME}:$BUILD_NUMBER
                            '''
                        }
                    }
                }
            }
        }
    //     stage('Scan Image') {
    //         steps {

    //         }
    //     }
    }

    post {
        success {
            echo "Build thành công service: ${params.SERVICE_NAME}"
        }
        failure {
            echo "Build thất bại, kiểm tra lại log của container tương ứng."
        }
    }
}