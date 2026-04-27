pipeline {
    agent {
        kubernetes {
            yaml readTrusted('jenkins/worker.yaml')
        }
    }

    parameters {
        choice(name: 'SERVICE_NAME', choices: ['frontend', 'gateway', 'auth'], description: 'Chọn service cần build')
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
                    withCredentials([usernamePassword(credentialsId: 'dockerhub-auth', usernameVariable: 'DOCKER_USER', passwordVariable: 'DOCKER_PASS')]) {
                        script {
                            def fullImageName = "${DOCKERHUB_REPO}/${params.SERVICE_NAME}:${env.BUILD_NUMBER}"
                            echo "--- Hệ thống đang đóng gói image: ${fullImageName} ---"
                            
                            sh '''
                            # 1. Đảm bảo thư mục cấu hình tồn tại
                            mkdir -p /kaniko/.docker
                            
                            # 2. Tạo chuỗi xác thực base64 sạch (không có ký tự xuống dòng)
                            AUTH=$(echo -n "${DOCKER_USER}:${DOCKER_PASS}" | base64 | tr -d '\n')
                            
                            # 3. Ghi file config.json đúng định dạng mà Kaniko yêu cầu
                            cat <<EOF > /kaniko/.docker/config.json
                                {
                                "auths": {
                                    "https://index.docker.io/v1/": {
                                    "auth": "${AUTH}"
                                    }
                                }
                                }
                                EOF
                            # 4. Thực thi Kaniko với context chính xác
                            /kaniko/executor \
                                --context ${WORKSPACE}/${params.SERVICE_NAME}/client \
                                --dockerfile ${WORKSPACE}/${params.SERVICE_NAME}/client/Dockerfile \
                                --destination ${DOCKERHUB_REPO}/${params.SERVICE_NAME}:${BUILD_NUMBER}
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