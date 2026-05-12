terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" { default = "us-east-1" }
variable "key_name" { default = "vockey" }

resource "aws_vpc" "vnf_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "vnf-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.vnf_vpc.id
}

resource "aws_subnet" "mgmt" {
  vpc_id                  = aws_vpc.vnf_vpc.id
  cidr_block              = "10.0.0.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "${var.aws_region}a"
}

resource "aws_subnet" "left" {
  vpc_id            = aws_vpc.vnf_vpc.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
}

resource "aws_subnet" "right" {
  vpc_id            = aws_vpc.vnf_vpc.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}a"
}

resource "aws_route_table" "mgmt_rt" {
  vpc_id = aws_vpc.vnf_vpc.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "mgmt_assoc" {
  subnet_id      = aws_subnet.mgmt.id
  route_table_id = aws_route_table.mgmt_rt.id
}

resource "aws_security_group" "allow_all" {
  vpc_id = aws_vpc.vnf_vpc.id

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "allow-all-vnf" }
}

resource "aws_network_interface" "vnf_nic_mgmt" {
  subnet_id       = aws_subnet.mgmt.id
  security_groups = [aws_security_group.allow_all.id]
}

resource "aws_network_interface" "vnf_nic_left" {
  subnet_id         = aws_subnet.left.id
  security_groups   = [aws_security_group.allow_all.id]
  source_dest_check = false
}

resource "aws_network_interface" "vnf_nic_right" {
  subnet_id         = aws_subnet.right.id
  security_groups   = [aws_security_group.allow_all.id]
  source_dest_check = false
}

resource "aws_instance" "vrouter" {
  ami           = "ami-0c7217cdde317cfec" 
  instance_type = "t3.small"
  key_name      = var.key_name

  network_interface {
    network_interface_id = aws_network_interface.vnf_nic_mgmt.id
    device_index         = 0
  }

  network_interface {
    network_interface_id = aws_network_interface.vnf_nic_left.id
    device_index         = 1
  }

  network_interface {
    network_interface_id = aws_network_interface.vnf_nic_right.id
    device_index         = 2
  }
  tags = { Name = "VNF-vRouter" }
}

resource "aws_network_interface" "client_nic_mgmt" {
  subnet_id       = aws_subnet.mgmt.id
  security_groups = [aws_security_group.allow_all.id]
}

resource "aws_network_interface" "client_nic_left" {
  subnet_id       = aws_subnet.left.id
  security_groups = [aws_security_group.allow_all.id]
}

resource "aws_instance" "client" {
  ami           = "ami-0c7217cdde317cfec"
  instance_type = "t2.micro"
  key_name      = var.key_name

  network_interface {
    network_interface_id = aws_network_interface.client_nic_mgmt.id
    device_index         = 0
  }
  network_interface {
    network_interface_id = aws_network_interface.client_nic_left.id
    device_index         = 1
  }
  tags = { Name = "VNF-Client" }
}

resource "aws_network_interface" "server_nic_mgmt" {
  subnet_id       = aws_subnet.mgmt.id
  security_groups = [aws_security_group.allow_all.id]
}

resource "aws_network_interface" "server_nic_right" {
  subnet_id       = aws_subnet.right.id
  security_groups = [aws_security_group.allow_all.id]
}

resource "aws_instance" "server" {
  ami           = "ami-0c7217cdde317cfec"
  instance_type = "t2.micro"
  key_name      = var.key_name

  network_interface {
    network_interface_id = aws_network_interface.server_nic_mgmt.id
    device_index         = 0
  }
  network_interface {
    network_interface_id = aws_network_interface.server_nic_right.id
    device_index         = 1
  }
  tags = { Name = "VNF-Server" }
}

output "SSH_vRouter" {
  value = "ssh -i ${var.key_name}.pem ubuntu@${aws_instance.vrouter.public_ip}"
}

output "SSH_Client" {
  value = "ssh -i ${var.key_name}.pem ubuntu@${aws_instance.client.public_ip}"
}

output "SSH_Server" {
  value = "ssh -i ${var.key_name}.pem ubuntu@${aws_instance.server.public_ip}"
}

output "COMMAND_DEMO_CURL" {
  value = "curl http://${aws_instance.server.private_ip}:8080"
}

resource "aws_eip" "vrouter_mgmt_eip" {
  domain = "vpc"
  tags   = { Name = "eip-vrouter-mgmt" }
}

resource "aws_eip_association" "vrouter_mgmt_assoc" {
  network_interface_id = aws_network_interface.vnf_nic_mgmt.id
  allocation_id        = aws_eip.vrouter_mgmt_eip.id
}

resource "aws_eip" "client_mgmt_eip" {
  domain = "vpc"
  tags   = { Name = "eip-client-mgmt" }
}

resource "aws_eip_association" "client_mgmt_assoc" {
  network_interface_id = aws_network_interface.client_nic_mgmt.id
  allocation_id        = aws_eip.client_mgmt_eip.id
}

resource "aws_eip" "server_mgmt_eip" {
  domain = "vpc"
  tags   = { Name = "eip-server-mgmt" }
}

resource "aws_eip_association" "server_mgmt_assoc" {
  network_interface_id = aws_network_interface.server_nic_mgmt.id
  allocation_id        = aws_eip.server_mgmt_eip.id
}